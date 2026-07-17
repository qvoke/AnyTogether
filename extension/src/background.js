import { getParserConfigForUrl } from "./parser-configs.js";
import { extractSeriesContextInPage } from "./extraction-engine.js";

const SEARCH_REQUEST_EVENT = "WT_SEARCH_REQUEST";
const RESOLVE_PAGE_REQUEST_EVENT = "WT_RESOLVE_PAGE_URL";
const SERIES_CONTEXT_FOUND_EVENT = "WT_SERIES_CONTEXT_FOUND";
const EXTENSION_STATUS_EVENT = "WT_EXTENSION_STATUS";
const EXTENSION_ERROR_EVENT = "WT_EXTENSION_ERROR";
const MEDIA_URL_REGEX = /https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/i;

function sendStatus(tabId, message) {
  if (typeof tabId !== "number") return;

  sendTabMessage(tabId, {
    type: EXTENSION_STATUS_EVENT,
    payload: { message }
  });
}

function sendError(tabId, message) {
  if (typeof tabId !== "number") return;

  sendTabMessage(tabId, {
    type: EXTENSION_ERROR_EVENT,
    payload: { message }
  });
}

function sendTabMessage(tabId, message) {
  if (typeof tabId !== "number") return;

  try {
    chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError);
  } catch {
    // The tab can disappear between lookup and delivery.
  }
}

function decodeDuckDuckGoHref(rawHref) {
  try {
    const url = new URL(rawHref);
    const wrapped = url.searchParams.get("uddg");
    return wrapped ? decodeURIComponent(wrapped) : rawHref;
  } catch {
    return rawHref;
  }
}

function buildSearchUrl(query) {
  const fullQuery = encodeURIComponent(query);
  return `https://html.duckduckgo.com/html/?q=${fullQuery}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeQualityLabel(label) {
  return String(label || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isPlayableQualityLabel(label) {
  const normalized = normalizeQualityLabel(label);
  if (!normalized) return false;
  if (normalized.includes("ultra")) return false;

  const compact = normalized.replace(/\s+/g, "");
  return /^(?:\d{3,4}(?:p|hd|fhd|uhd)?|\d{3,4}x\d{3,4}|[48]k)$/.test(compact);
}

function parseStreamOptions(streamText) {
  if (typeof streamText !== "string" || !streamText) return [];

  const options = [];
  const entries = streamText.split(/,(?=\[[^\]]+\])/g);

  for (const entry of entries) {
    const labelMatch = entry.match(/^\[([^\]]+)\]/);
    const urlMatch = entry.match(/https?:\/\/[^\s"'<>]+/i);

    if (!labelMatch || !urlMatch) continue;

    const label = String(labelMatch[1] || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const url = String(urlMatch[0] || "").trim();

    if (!label || !url) continue;
    if (!isPlayableQualityLabel(label)) continue;

    options.push({
      label,
      normalizedLabel: normalizeQualityLabel(label),
      url
    });
  }

  return options;
}

function pickStreamOption(options, preferredQualityLabel, defaultQualityLabel) {
  if (!Array.isArray(options) || options.length === 0) return null;

  const parseResolution = (label) => {
    const value = Number.parseInt(String(label || "").replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(value) ? value : null;
  };

  const preferred = normalizeQualityLabel(preferredQualityLabel);
  if (preferred) {
    const exactMatch = options.find((option) => option.normalizedLabel === preferred);
    if (exactMatch) return exactMatch;

    const looseMatch = options.find((option) => option.normalizedLabel.includes(preferred));
    if (looseMatch) return looseMatch;
  }

  const ranked = options
    .map((option) => ({ option, resolution: parseResolution(option.label) ?? parseResolution(option.normalizedLabel) ?? 0 }))
    .sort((a, b) => b.resolution - a.resolution);

  if (ranked.length && ranked[0].resolution > 0) {
    return ranked[0].option;
  }

  const defaultMatch = normalizeQualityLabel(defaultQualityLabel);
  if (defaultMatch) {
    const exactDefault = options.find((option) => option.normalizedLabel === defaultMatch);
    if (exactDefault) return exactDefault;
  }

  return options[0];
}

function pickHighestStreamOption(options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  return options
    .map((option) => ({ option, resolution: Number.parseInt(String(option?.label || "").replace(/[^0-9]/g, ""), 10) || 0 }))
    .sort((left, right) => right.resolution - left.resolution)[0]?.option || options[0];
}

const parseRezkaStreamOptions = parseStreamOptions;
const pickRezkaStreamOption = pickStreamOption;

function readObjectPath(value, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current == null) return null;
    current = current[part];
  }
  return current ?? null;
}

function resolveConfigValue(expression, context) {
  if (typeof expression !== "string" || !expression.startsWith("$")) {
    return expression;
  }

  return readObjectPath(context, expression.slice(1));
}

function getDirectResolverContext(seriesContext, targetEpisode, options = {}) {
  const resolver = seriesContext?.resolver || {};
  return {
    resolver,
    target: targetEpisode || {},
    selectedTranslatorId: Number.isFinite(Number(options.translatorId))
      ? Number(options.translatorId)
      : Number(seriesContext?.selectedTranslatorId ?? resolver.translatorId ?? null),
    selectedQualityLabel: options.qualityLabel || seriesContext?.selectedQualityLabel || null
  };
}

async function fetchDirectStreamList(resolverConfig, seriesContext, targetEpisode, options = {}) {
  if (!resolverConfig || resolverConfig.type !== "ajaxStreamList" || !seriesContext || !targetEpisode) {
    return null;
  }

  const context = getDirectResolverContext(seriesContext, targetEpisode, options);
  const origin = context.resolver.origin || seriesContext?.resolver?.origin;
  if (!origin || !resolverConfig.url) return null;

  const endpoint = new URL(resolverConfig.url, origin);
  if (resolverConfig.timestampQuery) {
    endpoint.searchParams.set(resolverConfig.timestampQuery, String(Date.now()));
  }

  const bodyValues = {};
  for (const [key, value] of Object.entries(resolverConfig.body || {})) {
    const resolvedValue = resolveConfigValue(value, context);
    bodyValues[key] = resolvedValue == null ? "" : String(resolvedValue);
  }

  try {
    const response = await fetch(endpoint.href, {
      method: resolverConfig.method || "POST",
      headers: resolverConfig.headers || {},
      body: new URLSearchParams(bodyValues)
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function buildDirectStreamResolution(resolverConfig, ajaxData, seriesContext, targetEpisode, options = {}) {
  const responseConfig = resolverConfig?.response || {};
  const streamList = readObjectPath(ajaxData, responseConfig.streamListPath || "url");
  if (!streamList || !seriesContext || !targetEpisode) return null;

  const streamOptions = parseStreamOptions(streamList);
  const selectedStream = pickRezkaStreamOption(
    streamOptions,
    options.qualityLabel,
    null
  );

  if (!selectedStream?.url) return null;

  const seasonId = Number(targetEpisode.seasonId);
  const episodeId = Number(targetEpisode.episodeId);
  const episodes = Array.isArray(seriesContext.episodes) ? seriesContext.episodes : [];
  const currentEpisodeIndex = episodes.findIndex(
    (episode) => Number(episode?.seasonId) === seasonId && Number(episode?.episodeId) === episodeId
  );

  return {
    mediaUrl: selectedStream.url,
    masterPlaylistUrl: null,
    pageUrl: seriesContext.resolver?.pageUrl || null,
    seriesContext: {
      ...seriesContext,
      currentEpisodeIndex,
      currentSeasonId: seasonId,
      currentEpisodeId: episodeId,
      selectedTranslatorId: Number(options.translatorId ?? seriesContext.selectedTranslatorId ?? seriesContext.resolver?.translatorId ?? null),
      selectedQualityLabel: selectedStream.label,
      availableQualities: streamOptions.map((option) => ({
        label: option.label,
        normalizedLabel: option.normalizedLabel
      }))
    }
  };
}

// ---------- HLS Master playlist resolver ----------

function isMasterPlaylist(playlistText) {
  return /#EXT-X-STREAM-INF\s*:/i.test(playlistText);
}

function isMediaPlaylist(playlistText) {
  return /#EXTINF\s*:/i.test(playlistText);
}

function pickBestVariantFromMaster(playlistText, baseUrl) {
  const lines = playlistText.split(/\r?\n/);
  const variants = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/#EXT-X-STREAM-INF\s*:/i.test(line)) continue;

    const attrs = {};
    const attrStr = line.replace(/^#EXT-X-STREAM-INF\s*:\s*/i, '');
    const attrRegex = /([A-Z_-]+)\s*=\s*(?:"([^"]*)"|([^,"\s]*))/gi;
    let match;
    while ((match = attrRegex.exec(attrStr)) !== null) {
      attrs[match[1].toUpperCase()] = match[2] !== undefined ? match[2] : match[3];
    }

    let j = i + 1;
    while (j < lines.length && (lines[j].startsWith('#') || lines[j].trim() === '')) {
      j++;
    }
    if (j >= lines.length) continue;

    const variantUrl = resolveUrl(lines[j].trim(), baseUrl);
    if (!variantUrl) continue;

    const bandwidth = parseInt(attrs.BANDWIDTH, 10) || 0;
    let resolution = 0;
    if (attrs.RESOLUTION) {
      const resMatch = attrs.RESOLUTION.match(/(\d+)\s*x\s*(\d+)/i);
      if (resMatch) resolution = parseInt(resMatch[2], 10);
    }

    variants.push({ url: variantUrl, bandwidth, resolution });
  }

  if (variants.length === 0) return null;

  variants.sort((a, b) => (b.resolution - a.resolution) || (b.bandwidth - a.bandwidth));

  return {
    url: variants[0].url,
    bandwidth: variants[0].bandwidth,
    resolution: variants[0].resolution,
    label: variants[0].resolution ? `${variants[0].resolution}p` : `${Math.round(variants[0].bandwidth / 1000)}k`,
    allVariants: variants.map(v => ({
      url: v.url,
      bandwidth: v.bandwidth,
      resolution: v.resolution,
      label: v.resolution ? `${v.resolution}p` : `${Math.round(v.bandwidth / 1000)}k`
    }))
  };
}

function resolveUrl(urlStr, baseUrlStr) {
  if (!urlStr) return null;
  try {
    return new URL(urlStr, baseUrlStr).href;
  } catch {
    return null;
  }
}

async function fetchPlaylist(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) return null;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Given an .m3u8 URL, try to resolve to best quality variant:
 * 2. If it's a media playlist, try common master playlist names in same dir
 * 3. Return the best quality media URL + master URL for hls.js
 */
function isMasterByFilename(filename) {
  const base = filename.split('?')[0].split('#')[0].toLowerCase();
  if (/^(master|index|playlist|manifest|multi|variant|adaptive)/i.test(base)) return true;
  if (!/\d{3,4}p?/.test(base) && !/_\d+x\d+/.test(base)) return true;
  return false;
}

function guessResolutionFromFilename(filename) {
  const base = filename.split('?')[0].split('#')[0];
  // 1080p, 720p, 360p
  const labeled = base.match(/(\d{3,4})\s*p/i);
  if (labeled) return parseInt(labeled[1], 10);
  // 1920x1080, 1280x720
  const dims = base.match(/(\d+)x(\d+)/i);
  if (dims) return parseInt(dims[2], 10);
  const number = base.match(/(\d{3,4})(?:\.[^.]+)?$/);
  if (number) return parseInt(number[1], 10);
  return 0;
}

function pickBestM3u8ByFilename(urls) {
  if (!urls || urls.length === 0) return null;

  const scored = urls.map(url => {
    const filename = url.split('/').pop() || '';
    const isMaster = isMasterByFilename(filename);
    const resolution = isMaster ? 99999 : guessResolutionFromFilename(filename);
    return { url, filename, isMaster, resolution, score: isMaster ? 100000 + resolution : resolution };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

async function resolveBestQualityHls(mediaUrl) {
  if (!mediaUrl || !/\.m3u8/i.test(mediaUrl)) return { url: mediaUrl, masterUrl: null, variants: null };

  const tryFetchAndAnalyze = async (url) => {
    try {
      const text = await fetchPlaylist(url);
      if (!text) return null;
      if (isMasterPlaylist(text)) {
        const best = pickBestVariantFromMaster(text, url);
        if (best) return { url: best.url, masterUrl: url, variants: best.allVariants, isMaster: true };
      }
      if (isMediaPlaylist(text)) return { url, masterUrl: null, variants: null, isMaster: false };
      return null;
    } catch {
      return null;
    }
  };

  const result1 = await tryFetchAndAnalyze(mediaUrl);
  if (result1) {
    if (result1.isMaster) return result1;
  }

  const urlObj = new URL(mediaUrl);
  const pathParts = urlObj.pathname.split('/');
  const filename = pathParts[pathParts.length - 1] || '';

  const masterCandidates = [
    'master.m3u8',
    'index.m3u8',
    'playlist.m3u8',
    'manifest.m3u8'
  ];

  for (const candidate of [...new Set(masterCandidates)]) {
    if (candidate === filename) continue;
    urlObj.pathname = [...pathParts.slice(0, -1), candidate].join('/');
    const result = await tryFetchAndAnalyze(urlObj.href);
    if (result && result.isMaster) {
      return { url: result.url, masterUrl: urlObj.href, variants: result.variants };
    }
  }

  const best = pickBestM3u8ByFilename([mediaUrl]);
  if (best && best.isMaster) {
    return { url: best.url, masterUrl: best.url, variants: null };
  }

  if (result1) return result1;

  return { url: mediaUrl, masterUrl: null, variants: null };
}

// ---------- End HLS Master playlist resolver ----------

async function clearOriginSiteData(pageUrl) {
  try {
    const origin = new URL(pageUrl).origin;
    await chrome.browsingData.remove(
      { origins: [origin] },
      {
        cookies: true,
        localStorage: true,
        indexedDB: true,
        cache: true,
        serviceWorkers: true,
        webSQL: true
      }
    );
  } catch {
    // The target page can still work if data removal is not available for this origin.
  }
}

function normalizePageUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

const SERIES_CONTEXT_CACHE = new Map();
const RESOLVE_REQUESTS_IN_FLIGHT = new Map();
const RESOLVER_TAB_IDS = new Set();
const SUPPRESSED_RESOLVER_PAGE_URLS = new Map();

function suppressResolverPageMedia(pageUrl, ttlMs = 30000) {
  const key = normalizePageUrl(pageUrl);
  if (!key) return;
  SUPPRESSED_RESOLVER_PAGE_URLS.set(key, Date.now() + ttlMs);
}

function isResolverPageMediaSuppressed(pageUrl) {
  const key = normalizePageUrl(pageUrl);
  if (!key) return false;
  const expiresAt = SUPPRESSED_RESOLVER_PAGE_URLS.get(key) || 0;
  if (expiresAt <= Date.now()) {
    SUPPRESSED_RESOLVER_PAGE_URLS.delete(key);
    return false;
  }
  return true;
}

function cacheSeriesContext(pageUrl, seriesContext) {
  const key = normalizePageUrl(pageUrl);
  if (!key || !seriesContext) return;
  SERIES_CONTEXT_CACHE.set(key, seriesContext);
}

function getCachedSeriesContext(pageUrl) {
  const key = normalizePageUrl(pageUrl);
  if (!key) return null;
  return SERIES_CONTEXT_CACHE.get(key) || null;
}

function samePageUrl(left, right) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.origin === rightUrl.origin &&
      leftUrl.pathname.replace(/\/+$/, "") === rightUrl.pathname.replace(/\/+$/, "")
    );
  } catch {
    return false;
  }
}

function sharedPathPrefixCount(left, right) {
  try {
    const leftSegments = new URL(left).pathname.split("/").filter(Boolean);
    const rightSegments = new URL(right).pathname.split("/").filter(Boolean);
    let count = 0;

    while (count < leftSegments.length && count < rightSegments.length) {
      if (leftSegments[count] !== rightSegments[count]) break;
      count += 1;
    }

    return count;
  } catch {
    return 0;
  }
}

async function getSearchCandidates(query, hostTabId) {
  const queryTokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);

  const searchTab = await chrome.tabs.create({
    url: buildSearchUrl(query),
    active: false
  });

  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      sendStatus(hostTabId, `Search page ready, extraction attempt ${attempt}`);
      await delay(1500);

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: searchTab.id },
        args: [queryTokens],
        func: (tokens) => {
          const scoreCandidate = (anchor) => {
            try {
              const url = new URL(anchor.href);
              if (!/^https?:$/.test(url.protocol)) return Number.NEGATIVE_INFINITY;
              if (url.hostname.includes("duckduckgo.com")) return Number.NEGATIVE_INFINITY;
              if (url.pathname === "/" || url.pathname === "") return Number.NEGATIVE_INFINITY;

              const text = `${anchor.textContent || ""} ${anchor.getAttribute("title") || ""} ${anchor.href}`.toLowerCase();
              let score = 0;

              for (const token of tokens) {
                if (text.includes(token)) {
                  score += 4;
                }
              }

              if (url.pathname.split("/").filter(Boolean).length > 0) {
                score += 2;
              }

              return score;
            } catch {
              return Number.NEGATIVE_INFINITY;
            }
          };

          const selectors = [
            "a.result__a[href]",
            'a[data-testid="result-title-a"][href]',
            "article a[href]",
            "h2 a[href]",
            "a[href]"
          ];

          const anchors = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
          const ranked = anchors
            .map((anchor) => ({ anchor, score: scoreCandidate(anchor) }))
            .filter((item) => Number.isFinite(item.score))
            .sort((a, b) => b.score - a.score);

          const candidates = ranked.slice(0, 8).map((item) => item.anchor.href);

          if (candidates.length > 0) {
            return candidates;
          }

          const bodyText = document.body?.innerText || "";
          const fallback = [];
          const explicitUrls = bodyText.match(/https?:\/\/[^\s"'<>]+/gi) || [];
          const urlishPaths = bodyText.match(/\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>]+)?/gi) || [];

          for (const candidate of [...explicitUrls, ...urlishPaths]) {
            const normalizedCandidate = candidate.startsWith("http")
              ? candidate
              : `https://${candidate}`;

            if (normalizedCandidate.includes("...")) continue;

            try {
              const url = new URL(normalizedCandidate);
              if (url.hostname.includes("duckduckgo.com")) continue;
              fallback.push(normalizedCandidate);
            } catch {
              continue;
            }
          }

          return [...new Set(fallback)].slice(0, 8);
        }
      });

      const candidates = (result?.result || []).map((candidate) => decodeDuckDuckGoHref(candidate));
      const uniqueCandidates = [...new Set(candidates)].filter(Boolean);

      sendStatus(hostTabId, `Search candidates found: ${uniqueCandidates.length}`);
      if (uniqueCandidates.length > 0) {
        return uniqueCandidates;
      }

      sendStatus(hostTabId, "No result on this attempt, retrying");
    }

    return [];
  } finally {
    try {
      chrome.tabs.remove(searchTab.id, () => void chrome.runtime.lastError);
    } catch {
      // The search tab can close on its own or be removed by the user.
    }
  }
}

function waitForMediaUrl(tabId, timeoutMs = 15000) {
  let stop = () => {};

  const promise = new Promise((resolve) => {
    const collectedUrls = [];
    const timeoutId = setTimeout(async () => {
      chrome.webRequest.onBeforeRequest.removeListener(listener);

      const m3u8Urls = [...new Set(collectedUrls.filter(url => /\.m3u8/i.test(url)))];
      const mp4Urls = [...new Set(collectedUrls.filter(url => /\.mp4/i.test(url)))];

      if (m3u8Urls.length > 0) {
        for (const url of m3u8Urls) {
          const resolved = await resolveBestQualityHls(url);
          if (resolved?.masterUrl || resolved?.variants) {
            resolve(resolved.masterUrl || url);
            return;
          }
        }
        for (const url of m3u8Urls) {
          const resolved = await resolveBestQualityHls(url);
          if (resolved?.url) {
            resolve(resolved.url);
            return;
          }
        }
        resolve(m3u8Urls[0]);
        return;
      }

      if (mp4Urls.length > 0) {
        resolve(mp4Urls[0]);
        return;
      }

      resolve(null);
    }, timeoutMs);

    function listener(details) {
      const candidate = details.url || "";
      if (!MEDIA_URL_REGEX.test(candidate)) return;
      collectedUrls.push(candidate);
    }

    stop = () => {
      clearTimeout(timeoutId);
      chrome.webRequest.onBeforeRequest.removeListener(listener);
    };

    chrome.webRequest.onBeforeRequest.addListener(
      listener,
      { urls: ["<all_urls>"], tabId },
      []
    );
  });

  return { promise, stop };
}

async function extractMediaUrlFromPage(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        // Helper functions
        const isMasterPlaylist = (text) => /#EXT-X-STREAM-INF\s*:/i.test(text);
        const isMediaPlaylist = (text) => /#EXTINF\s*:/i.test(text);

        const isMasterByFilename = (url) => {
          const base = url.split('/').pop()?.split('?')[0]?.split('#')[0]?.toLowerCase() || '';
          if (/^(master|index|playlist|manifest|multi|variant|adaptive)/i.test(base)) return true;
          if (/\d{3,4}p?/.test(base)) return false;
          if (/_\d+x\d+/.test(base)) return false;
          if (/\d{3,4}(?:\.[^.]+)?$/.test(base)) return false;
          return true;
        };

        const guessResolution = (url) => {
          const base = url.split('/').pop()?.split('?')[0] || '';
          const labeled = base.match(/(\d{3,4})\s*p/i);
          if (labeled) return parseInt(labeled[1], 10);
          const dims = base.match(/(\d+)x(\d+)/i);
          if (dims) return parseInt(dims[2], 10);
          const number = base.match(/(\d{3,4})(?:\.[^.]+)?$/);
          if (number) return parseInt(number[1], 10);
          return 0;
        };
        async function analyzeM3u8(url) {
          try {
            const response = await fetch(url, {
              method: 'GET',
              cache: 'no-store',
              credentials: 'include',
              redirect: 'follow'
            });
            if (!response.ok) return null;
            const text = await response.text();
            if (!text) return null;

            if (isMasterPlaylist(text)) {
              const lines = text.split(/\r?\n/);
              const variants = [];
              for (let i = 0; i < lines.length; i++) {
                if (!/#EXT-X-STREAM-INF\s*:/i.test(lines[i])) continue;
                const resMatch = lines[i].match(/RESOLUTION\s*=\s*(\d+)x(\d+)/i);
                let j = i + 1;
                while (j < lines.length && (lines[j].startsWith('#') || !lines[j].trim())) j++;
                if (j >= lines.length) continue;
                const variantUrl = lines[j].trim().startsWith('http')
                  ? lines[j].trim()
                  : new URL(lines[j].trim(), url).href;
                const height = resMatch ? parseInt(resMatch[2], 10) : 0;
                variants.push({ url: variantUrl, height });
              }
              if (variants.length > 0) {
                variants.sort((a, b) => b.height - a.height);
                return { isMaster: true, bestUrl: variants[0].url, variants };
              }
              return { isMaster: true, bestUrl: url, variants: [] };
            }

            if (isMediaPlaylist(text)) {
              return { isMaster: false, bestUrl: url, variants: null };
            }

            return null;
          } catch {
            return null;
          }
        }

        const m3u8Urls = new Set();
        const mp4Urls = new Set();

        const addUrl = (value) => {
          if (!value || typeof value !== "string") return;
          if (/(?:blob:|data:)/i.test(value)) return;
          if (/https?:\/\/[^\s"'<>]+?\.(?:m3u8)(?:\?[^\s"'<>]*)?/i.test(value)) {
            m3u8Urls.add(value);
          } else if (/https?:\/\/[^\s"'<>]+?\.(?:mp4)(?:\?[^\s"'<>]*)?/i.test(value)) {
            mp4Urls.add(value);
          }
        };

        document.querySelectorAll("video, video source, source, meta").forEach((node) => {
          if (node.tagName === "VIDEO") { addUrl(node.currentSrc); addUrl(node.src); }
          if (node.tagName === "SOURCE") { addUrl(node.src); }
          if (node.tagName === "META") { addUrl(node.content); }
        });

        for (const script of document.scripts) {
          const text = script.textContent || "";
          const escaped = text.match(/https?:\\\/\\\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:[^\s"'<>]*)/gi);
          if (escaped) escaped.forEach(m => addUrl(m.replace(/\\\//g, '/')));
          const plain = text.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi);
          if (plain) plain.forEach(addUrl);
        }

        const html = document.documentElement.innerHTML;
        const htmlEscaped = html.match(/https?:\\\/\\\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:[^\s"'<>]*)/gi);
        if (htmlEscaped) htmlEscaped.forEach(m => addUrl(m.replace(/\\\//g, '/')));
        const htmlPlain = html.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi);
        if (htmlPlain) htmlPlain.forEach(addUrl);

        const m3u8List = [...m3u8Urls];

        const uniqueM3u8 = [...new Set(m3u8List)];
        const urlsToTry = uniqueM3u8.slice(0, 5);

        for (const url of urlsToTry) {
          const analysis = await analyzeM3u8(url);
          if (analysis && analysis.isMaster) {
            return {
              mediaUrl: analysis.bestUrl,
              masterPlaylistUrl: url,
              allVariants: analysis.variants
            };
          }
        }

        for (const url of m3u8List) {
          if (isMasterByFilename(url)) {
            const analysis = await analyzeM3u8(url);
            if (analysis && analysis.isMaster) {
              return {
                mediaUrl: analysis.bestUrl,
                masterPlaylistUrl: url,
                allVariants: analysis.variants
              };
            }
          }
        }

        for (const mediaUrl of m3u8List) {
          try {
            const mediaObj = new URL(mediaUrl);
            const pathParts = mediaObj.pathname.split('/');
            const filename = pathParts.pop();
            const dir = pathParts.join('/');

            const masterNames = ['master.m3u8', 'index.m3u8', 'playlist.m3u8', 'manifest.m3u8'];
            for (const name of masterNames) {
              if (name === filename) continue;
              const candidateUrl = mediaObj.origin + dir + '/' + name;
              const analysis = await analyzeM3u8(candidateUrl);
              if (analysis && analysis.isMaster) {
                return {
                  mediaUrl: analysis.bestUrl,
                  masterPlaylistUrl: candidateUrl,
                  allVariants: analysis.variants
                };
              }
            }
          } catch {}
        }

        let bestUrl = null;
        let bestResolution = 0;
        for (const url of m3u8List) {
          const res = guessResolution(url);
          if (res > bestResolution) {
            bestResolution = res;
            bestUrl = url;
          }
        }
        if (bestUrl) {
          return { mediaUrl: bestUrl, masterPlaylistUrl: null };
        }

        // 5) MP4 fallback
        if (mp4Urls.size > 0) {
          return { mediaUrl: [...mp4Urls][0], masterPlaylistUrl: null };
        }

        return null;
      }
    });

    return result?.result || null;
  } catch {
    return null;
  }
}

async function extractSeriesContextViaProfile(tabId, pageUrl) {
  const profile = await getParserConfigForUrl(pageUrl);
  const pickBestSeriesContext = (results) => {
    const contexts = (Array.isArray(results) ? results : [])
      .map((result) => result?.result)
      .filter(Boolean);
    if (contexts.length === 0) return null;

    return contexts
      .map((context) => ({
        context,
        score:
          (Array.isArray(context.seasons) ? context.seasons.length * 20 : 0) +
          (Array.isArray(context.episodes) ? context.episodes.length : 0) +
          (Array.isArray(context.translators) ? context.translators.length * 5 : 0) +
          (Array.isArray(context.availableQualities) ? context.availableQualities.length : 0)
      }))
      .sort((left, right) => right.score - left.score)[0]?.context || null;
  };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        args: [pageUrl, profile],
        func: extractSeriesContextInPage
      });

      const context = pickBestSeriesContext(results);
      if (context) {
        return context;
      }
    } catch (e) {
      console.error("[Background] extractSeriesContextViaProfile error:", attempt, e);
    }

    await delay(500);
  }

  return null;
}

async function extractSeriesContextFromPage(tabId, pageUrl) {
  const profileResult = await extractSeriesContextViaProfile(tabId, pageUrl);
  if (profileResult) {
    return profileResult;
  }

  return null;
}

async function fetchEpisodeMediaInTab(tabId, seriesContext, targetEpisode, options = {}) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [seriesContext, targetEpisode, options],
      func: async (seriesContextArg, targetEpisodeArg, optionsArg) => {
        const resolver = seriesContextArg?.resolver;
        if (!resolver) return null;

        const itemId = Number(resolver.itemId);
        const translatorId = Number(
          Number.isFinite(Number(optionsArg.translatorId)) ? optionsArg.translatorId : resolver.translatorId
        );
        const seasonId = Number(targetEpisodeArg?.seasonId);
        const episodeId = Number(targetEpisodeArg?.episodeId);

        if (!Number.isFinite(itemId) || !Number.isFinite(translatorId) || !Number.isFinite(seasonId) || !Number.isFinite(episodeId)) {
          return null;
        }

        const origin = window.location.origin;
        const endpoint = `${origin}/ajax/get_cdn_series/?t=${Date.now()}`;

        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest"
            },
            body: new URLSearchParams({
              id: String(itemId),
              translator_id: String(translatorId),
              season: String(seasonId),
              episode: String(episodeId),
              favs: resolver.favs || "",
              action: "get_stream"
            })
          });

          if (!response.ok) return null;
          try {
            return await response.json();
          } catch {
            return null;
          }
        } catch (e) {
          return null;
        }
      }
    });

    return result?.result || null;
  } catch (e) {
    console.error("[Background] Error in fetchEpisodeMediaInTab:", e);
    return null;
  }
}

async function fetchRezkaEpisodeMediaInTab(tabId, seriesContext, targetEpisode, options = {}) {
  return fetchEpisodeMediaInTab(tabId, seriesContext, targetEpisode, options);
}

async function resolveMediaViaProfile(tabId, currentPageUrl, profile, seriesContext, targetEpisode, hostTabId, mediaCapture) {
  const mediaSources = Array.isArray(profile?.mediaExtraction) && profile.mediaExtraction.length > 0
    ? profile.mediaExtraction
    : Array.isArray(profile?.mediaSources) && profile.mediaSources.length > 0
      ? profile.mediaSources
      : ["dom-video", "network-sniff", "page-extract"];
  const activeContext = targetEpisode?.seriesContext || seriesContext || null;
  const canUseRezkaAjax = profile?.id === "rezka" && activeContext?.resolver?.provider === "rezka";
  let episodeActivated = false;

  const ensureEpisodeActivated = async () => {
    if (!targetEpisode || episodeActivated) return episodeActivated;
    sendStatus(hostTabId, `Selecting episode: S${targetEpisode.seasonId} E${targetEpisode.episodeId}`);
    episodeActivated = await activateTargetEpisodeOnPage(tabId, targetEpisode, activeContext, profile, hostTabId);
    if (!episodeActivated) {
      sendError(hostTabId, "Episode selection failed");
    }
    return episodeActivated;
  };

  const finalizeAjaxPayload = (ajaxData, selectedStream, context) => {
    if (!selectedStream?.url) return null;

    const baseContext = context || activeContext || seriesContext || null;
    const episodes = Array.isArray(baseContext?.episodes) ? baseContext.episodes : [];
    const currentEpisodeIndex = targetEpisode
      ? episodes.findIndex(
          (episode) => Number(episode?.seasonId) === Number(targetEpisode.seasonId) && Number(episode?.episodeId) === Number(targetEpisode.episodeId)
        )
      : Math.max(0, episodes.findIndex((episode) => Number(episode?.seasonId) === Number(baseContext?.currentSeasonId) && Number(episode?.episodeId) === Number(baseContext?.currentEpisodeId)));

    return {
      mediaUrl: selectedStream.url,
      masterPlaylistUrl: null,
      pageUrl: currentPageUrl,
      seriesContext: {
        ...(baseContext || {}),
        currentEpisodeIndex,
        currentSeasonId: targetEpisode ? Number(targetEpisode.seasonId) : Number(baseContext?.currentSeasonId) || null,
        currentEpisodeId: targetEpisode ? Number(targetEpisode.episodeId) : Number(baseContext?.currentEpisodeId) || null,
        selectedTranslatorId: Number(
          targetEpisode?.selectedTranslatorId ?? baseContext?.selectedTranslatorId ?? baseContext?.resolver?.translatorId ?? null
        ),
        selectedQualityLabel: selectedStream.label,
        availableQualities: ajaxData?.url
          ? parseRezkaStreamOptions(ajaxData.url).map((option) => ({
              label: option.label,
              normalizedLabel: option.normalizedLabel
            }))
          : []
      }
    };
  };

  const buildTargetSeriesContext = () => {
    const baseContext = activeContext || seriesContext || null;
    if (!baseContext || !targetEpisode) return baseContext;

    const episodes = Array.isArray(baseContext.episodes) ? baseContext.episodes : [];
    const currentEpisodeIndex = episodes.findIndex(
      (episode) => Number(episode?.seasonId) === Number(targetEpisode.seasonId) && Number(episode?.episodeId) === Number(targetEpisode.episodeId)
    );

    return {
      ...baseContext,
      currentEpisodeIndex,
      currentSeasonId: Number(targetEpisode.seasonId),
      currentEpisodeId: Number(targetEpisode.episodeId),
      selectedTranslatorId: Number(
        targetEpisode.selectedTranslatorId ?? baseContext.selectedTranslatorId ?? baseContext.resolver?.translatorId ?? null
      ) || null,
      selectedQualityLabel: targetEpisode.selectedQualityLabel || baseContext.selectedQualityLabel || null
    };
  };

  for (const source of mediaSources) {
    const sourceType = typeof source === "string" ? source : source?.type;

    if ((sourceType === "rezkaAjax" || sourceType === "rezka-ajax") && canUseRezkaAjax) {
      if (!activeContext?.resolver?.itemId) continue;

      if (targetEpisode) {
        sendStatus(hostTabId, "Fetching episode stream directly via tab context");
        const ajaxData = await fetchRezkaEpisodeMediaInTab(tabId, activeContext, targetEpisode, {
          translatorId: targetEpisode.selectedTranslatorId,
          qualityLabel: targetEpisode.selectedQualityLabel
        });

        if (ajaxData?.url) {
          const streamOptions = parseRezkaStreamOptions(ajaxData.url);
          const selectedStream = pickRezkaStreamOption(
            streamOptions,
            targetEpisode.selectedQualityLabel,
            null
          );
          const resolved = finalizeAjaxPayload(ajaxData, selectedStream, activeContext);
          if (resolved) {
            sendStatus(hostTabId, "Media URL captured from tab AJAX fetch");
            return resolved;
          }
        }
      } else {
        const currentSeasonId = Number(activeContext?.currentSeasonId);
        const currentEpisodeId = Number(activeContext?.currentEpisodeId);
        if (Number.isFinite(currentSeasonId) && Number.isFinite(currentEpisodeId)) {
          sendStatus(hostTabId, "Fetching default episode stream via tab context");
          const ajaxData = await fetchRezkaEpisodeMediaInTab(tabId, activeContext, {
            seasonId: currentSeasonId,
            episodeId: currentEpisodeId
          }, {
            translatorId: activeContext?.selectedTranslatorId ?? activeContext?.resolver?.translatorId,
            qualityLabel: activeContext?.selectedQualityLabel || "1080p"
          });

          if (ajaxData?.url) {
            const streamOptions = parseRezkaStreamOptions(ajaxData.url);
            const selectedStream = pickRezkaStreamOption(
              streamOptions,
              activeContext?.selectedQualityLabel,
              null
            );
            const resolved = finalizeAjaxPayload(ajaxData, selectedStream, activeContext);
            if (resolved) {
              sendStatus(hostTabId, `Stream resolved via tab: ${selectedStream.label}`);
              return resolved;
            }
          }
        }
      }
    }

    if (sourceType === "domVideo" || sourceType === "dom-video") {
      if (targetEpisode) {
        await ensureEpisodeActivated();
      }
      continue;
    }

    if (sourceType === "networkSniff" || sourceType === "network-sniff") {
      if (targetEpisode) {
        await ensureEpisodeActivated();
      }
      sendStatus(hostTabId, "Sniffing media requests");
      const mediaUrl = await mediaCapture.promise;
      if (mediaUrl) {
        return { mediaUrl, masterPlaylistUrl: null, pageUrl: currentPageUrl, seriesContext: buildTargetSeriesContext() };
      }
      continue;
    }

    if (sourceType === "pageExtract" || sourceType === "page-extract") {
      sendStatus(hostTabId, "Falling back to page media extraction");
      const pageResult = await extractMediaUrlFromPage(tabId);
      if (pageResult) {
        return {
          mediaUrl: pageResult.mediaUrl || pageResult,
          masterPlaylistUrl: pageResult.masterPlaylistUrl || null,
          pageUrl: currentPageUrl,
          seriesContext: buildTargetSeriesContext()
        };
      }
    }
  }

  return null;
}

async function activateTargetEpisodeOnPage(tabId, targetEpisode, seriesContext = null, profile = null, hostTabId = null) {
  const seasonId = Number(targetEpisode?.seasonId);
  const episodeId = Number(targetEpisode?.episodeId);
  const activation = profile?.episodeActivation || {};
  const attempts = Number(activation.attempts) || 6;
  const clickDelayMs = Number(activation.clickDelayMs) || 1000;

  if (!Number.isFinite(seasonId) || !Number.isFinite(episodeId)) {
    return false;
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [{ seasonId, episodeId }, activation],
      func: (target, activationArg) => {
        const fillTemplate = (template) =>
          String(template || "")
            .replaceAll("{seasonId}", String(target.seasonId))
            .replaceAll("{episodeId}", String(target.episodeId));

        const collectShadowRoots = (rootDocument = document, maxRoots = 80) => {
          const roots = [rootDocument];
          const queue = [rootDocument.documentElement, rootDocument.body].filter(Boolean);
          const visited = new Set(queue);

          while (queue.length > 0 && roots.length < maxRoots) {
            const node = queue.shift();
            if (!node) continue;

            if (node.shadowRoot && !visited.has(node.shadowRoot)) {
              visited.add(node.shadowRoot);
              roots.push(node.shadowRoot);
              queue.push(...node.shadowRoot.querySelectorAll("*"));
            }

            if (node.querySelectorAll) {
              for (const child of node.querySelectorAll("*")) {
                if (visited.has(child)) continue;
                visited.add(child);
                queue.push(child);
              }
            }
          }

          return roots;
        };

        const queryAll = (selector) => {
          const nodes = [];
          for (const root of collectShadowRoots(document)) {
            try {
              nodes.push(...root.querySelectorAll(selector));
            } catch {
              continue;
            }
          }
          return [...new Set(nodes)];
        };

        const seasonSelector = fillTemplate(
          activationArg?.seasonSelectorTemplate || '#simple-seasons-tabs .b-simple_season__item[data-tab_id="{seasonId}"]'
        );
        const episodeSelector = fillTemplate(
          activationArg?.episodeSelectorTemplate || '#simple-episodes-list-{seasonId} .b-simple_episode__item[data-season_id="{seasonId}"][data-episode_id="{episodeId}"]'
        );
        const activeSelector = activationArg?.activeSelector || ".active";
        const seasonMePattern = new RegExp(activationArg?.seasonMePattern || "^(?:head_)?x-\\d+-(\\d+)$");
        const episodeMePattern = new RegExp(activationArg?.episodeMePattern || "^(?:head_)?xx-\\d+-(\\d+)-\\d+-\\d+-(\\d+)$");
        const isActive = (node) => {
          try {
            return Boolean(node?.matches?.(activeSelector));
          } catch {
            return false;
          }
        };
        const isHeaderNode = (node) => /^head_/i.test(String(node?.getAttribute?.("me") || ""));
        const getMeMatches = () => queryAll("hdvbplayer[me]");
        const pickSeasonCandidate = () => {
          const candidates = queryAll(seasonSelector);
          const matchedBySelector = candidates.find(isActive) ||
            candidates.find((node) => !isHeaderNode(node)) ||
            candidates[0] ||
            null;
          if (matchedBySelector) return matchedBySelector;

          const meCandidates = getMeMatches().filter((node) => seasonMePattern.test(String(node.getAttribute("me") || "")));
          return meCandidates.find(isActive) ||
            meCandidates.find((node) => !isHeaderNode(node)) ||
            meCandidates[0] ||
            null;
        };
        const pickEpisodeCandidate = () => {
          const candidates = queryAll(episodeSelector);
          const matchedBySelector = candidates.find(isActive) ||
            candidates.find((node) => !isHeaderNode(node)) ||
            candidates[0] ||
            null;
          if (matchedBySelector) return matchedBySelector;

          const meCandidates = getMeMatches().filter((node) => {
            const me = String(node.getAttribute("me") || "");
            const match = me.match(episodeMePattern);
            return Boolean(match && Number(match[1]) === Number(target.seasonId) && Number(match[2]) === Number(target.episodeId));
          });
          return meCandidates.find(isActive) ||
            meCandidates.find((node) => !isHeaderNode(node)) ||
            meCandidates[0] ||
            null;
        };
        const activateNode = (node) => {
          if (!node) return false;
          try {
            node.scrollIntoView?.({ block: "center", inline: "center" });
          } catch {}
          for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
            node.dispatchEvent(new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              view: window
            }));
          }
          return true;
        };
        const seasonButton = pickSeasonCandidate();
        const episodeButton = pickEpisodeCandidate();

        if (!episodeButton) {
          return { ok: false, reason: "episode-missing" };
        }

        if (seasonButton && !isActive(seasonButton)) {
          activateNode(seasonButton);
          return { ok: false, reason: "season-switch" };
        }

        if (!isActive(episodeButton)) {
          activateNode(episodeButton);
          return { ok: true };
        }

        return { ok: true };
      }
    });

    const frameResults = (Array.isArray(results) ? results : [])
      .map((result) => result?.result)
      .filter(Boolean);

    if (frameResults.some((result) => result.ok)) {
      sendStatus(hostTabId, "Episode selection clicked");
      return true;
    }

    if (attempt === attempts) {
      const reasonCounts = frameResults.reduce((counts, result) => {
        const reason = result.reason || "unknown";
        counts[reason] = (counts[reason] || 0) + 1;
        return counts;
      }, {});
      const summary = Object.entries(reasonCounts)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(", ") || "no-frame-results";
      sendStatus(hostTabId, `Episode activation failed: ${summary}`);
    }

    await delay(clickDelayMs);
  }

  return false;
}

async function resolvePageToMedia(pageUrl, hostTabId, statusPrefix, targetEpisode = null, reuseTabId = null) {
  const profile = await getParserConfigForUrl(pageUrl);
  const activeRequestContext = targetEpisode?.seriesContext || null;

  const directResolver = Array.isArray(profile?.directResolvers)
    ? profile.directResolvers.find((resolverConfig) => resolverConfig.provider === activeRequestContext?.resolver?.provider)
    : null;

  if (targetEpisode && directResolver && activeRequestContext?.resolver?.provider) {
    sendStatus(hostTabId, "Fetching episode stream directly");
    const ajaxData = await fetchDirectStreamList(directResolver, activeRequestContext, targetEpisode, {
      translatorId: targetEpisode.selectedTranslatorId,
      qualityLabel: targetEpisode.selectedQualityLabel
    });
    const directResolution = buildDirectStreamResolution(directResolver, ajaxData, activeRequestContext, targetEpisode, {
      translatorId: targetEpisode.selectedTranslatorId,
      qualityLabel: targetEpisode.selectedQualityLabel
    });

    if (directResolution?.mediaUrl) {
      sendStatus(hostTabId, "Episode stream resolved directly");
      return {
        ...directResolution,
        pageUrl: directResolution.pageUrl || normalizePageUrl(pageUrl) || pageUrl
      };
    }

    sendStatus(hostTabId, "Direct episode stream failed, using page fallback");
  }

  const createdTab = !Number.isFinite(reuseTabId);
  const tabId = createdTab ? (await chrome.tabs.create({ url: "about:blank", active: false })).id : reuseTabId;
  if (Number.isFinite(tabId)) {
    RESOLVER_TAB_IDS.add(tabId);
  }
  suppressResolverPageMedia(pageUrl);
  const mediaCapture = waitForMediaUrl(tabId);

  try {
    sendStatus(hostTabId, `${statusPrefix}: ${pageUrl}`);
    sendStatus(hostTabId, "Clearing saved playback state");
    await clearOriginSiteData(pageUrl);
    await chrome.tabs.update(tabId, { url: pageUrl });
    await delay(3000);

    const currentTab = await chrome.tabs.get(tabId);
    const currentPageUrl = typeof currentTab.url === "string" ? currentTab.url : pageUrl;
    suppressResolverPageMedia(currentPageUrl);

    if (currentPageUrl.startsWith("chrome-error://")) {
      sendStatus(hostTabId, "Target page opened as an error page");
      return null;
    }

    let seriesContext = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      sendStatus(hostTabId, `Reading page content for media URLs (context attempt ${attempt}/3)`);
      seriesContext = await extractSeriesContextFromPage(tabId, currentPageUrl);
      if (seriesContext) {
        cacheSeriesContext(currentPageUrl, seriesContext);
        break;
      }
      await delay(1200);
    }

    if (seriesContext) {
      sendStatus(hostTabId, `Series context found: ${Array.isArray(seriesContext.seasons) ? seriesContext.seasons.length : 0} seasons, ${Array.isArray(seriesContext.episodes) ? seriesContext.episodes.length : 0} episodes`);
    } else {
      sendStatus(hostTabId, "Series context not found on page");
    }

    const resolution = await resolveMediaViaProfile(tabId, currentPageUrl, profile, seriesContext, targetEpisode, hostTabId, mediaCapture);
    if (!resolution?.mediaUrl) {
      return null;
    }

    let mediaUrl = resolution.mediaUrl;
    const resolvedSeriesContext = resolution.seriesContext || seriesContext;
    sendStatus(hostTabId, targetEpisode ? "Media URL captured after episode switch" : "Media URL captured from network");

    let finalMediaUrl = mediaUrl;
    let finalMasterUrl = null;
    let finalVariants = null;

    if (/\.m3u8/i.test(mediaUrl)) {
      const qualityResolved = await resolveBestQualityHls(mediaUrl);
      finalMediaUrl = qualityResolved.url;
      finalMasterUrl = qualityResolved.masterUrl;
      finalVariants = qualityResolved.variants;
    }

    const cachedSeriesContext = getCachedSeriesContext(currentPageUrl);
    const finalSeriesContext = resolvedSeriesContext || cachedSeriesContext;

    if (finalSeriesContext) {
      cacheSeriesContext(currentPageUrl, finalSeriesContext);
    }

    return {
      mediaUrl: finalMediaUrl,
      masterPlaylistUrl: finalMasterUrl,
      pageUrl: currentPageUrl,
      seriesContext: finalVariants ? {
        ...(finalSeriesContext || {}),
        masterPlaylistUrl: finalMasterUrl,
        availableQualities: finalVariants.map(v => ({
          label: v.label,
          normalizedLabel: v.label.toLowerCase().replace(/[^a-z0-9]/g, '')
        }))
      } : finalSeriesContext
    };
  } finally {
    mediaCapture.stop();
    if (Number.isFinite(tabId)) {
      RESOLVER_TAB_IDS.delete(tabId);
    }
    try {
      if (createdTab) {
        chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
      }
    } catch {
      // The helper tab can already be gone when the resolver finishes.
    }
  }
}

function buildResolveRequestKey(pageUrl, targetEpisode = null) {
  return JSON.stringify({
    pageUrl: normalizePageUrl(pageUrl) || pageUrl,
    seasonId: targetEpisode?.seasonId ?? null,
    episodeId: targetEpisode?.episodeId ?? null,
    translatorId: targetEpisode?.selectedTranslatorId ?? null,
    qualityLabel: targetEpisode?.selectedQualityLabel ?? null
  });
}

async function resolvePageToMediaOnce(pageUrl, hostTabId, statusPrefix, targetEpisode = null) {
  const key = buildResolveRequestKey(pageUrl, targetEpisode);
  if (RESOLVE_REQUESTS_IN_FLIGHT.has(key)) {
    return RESOLVE_REQUESTS_IN_FLIGHT.get(key);
  }

  const promise = resolvePageToMedia(pageUrl, hostTabId, statusPrefix, targetEpisode)
    .finally(() => {
      RESOLVE_REQUESTS_IN_FLIGHT.delete(key);
    });

  RESOLVE_REQUESTS_IN_FLIGHT.set(key, promise);
  return promise;
}
// Extract real URL from DuckDuckGo redirect (/l/?uddg=...)
function extractRealDdgUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('duckduckgo.com') && u.searchParams.has('uddg')) {
      return decodeURIComponent(u.searchParams.get('uddg'));
    }
  } catch(e) {}
  return url;
}

const FORWARDED_MEDIA_DEDUP_MS = 5000;
const FORWARDED_MEDIA_CACHE = new Map();

function buildMediaForwardSignature(mediaUrl, pageUrl, seriesContext, sourcePageUrl) {
  const context = seriesContext || {};
  return JSON.stringify({
    mediaUrl: String(mediaUrl || ""),
    pageUrl: String(pageUrl || ""),
    sourcePageUrl: String(sourcePageUrl || ""),
    seasonId: context.currentSeasonId ?? null,
    episodeId: context.currentEpisodeId ?? null,
    translatorId: context.selectedTranslatorId ?? null,
    qualityLabel: context.selectedQualityLabel || null,
    seasonCount: Array.isArray(context.seasons) ? context.seasons.length : 0,
    episodeCount: Array.isArray(context.episodes) ? context.episodes.length : 0
  });
}

// Forward URL to all UI page tabs
function forwardToUi(url) {
  const realUrl = extractRealDdgUrl(url);
  console.log("[Background] Forwarding to UI:", (realUrl || url).substring(0, 100));
  chrome.tabs.query({}, (allTabs) => {
    if (!allTabs) return;
    allTabs.filter(t => t.status === 'complete' && t.url && t.url.includes('localhost:3000'))
      .forEach(tab => {
        sendTabMessage(tab.id, {
          type: "WT_SEARCH_RESULT_CLICKED",
          payload: { url: realUrl || url }
        });
      });
  });
}

// Intercept DuckDuckGo redirect requests
// Instead of blocking, we let the request proceed normally.
// BUT we forward the real URL to UI so it knows about the click.
// The popup itself will navigate via the DDG redirect automatically.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url || '';
    if (url.includes('/l/?uddg=') || url.includes('uddg=')) {
      forwardToUi(url);
    }
  },
  { urls: ["*://duckduckgo.com/l/*"] },
  []
);

// Sniffer global state (persisted via storage)
let _snifferActive = false;
let _searchPopupTabId = null;

// Track search popup tab (opened by window.open from UI page)
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  if (details.sourceTabId > 0) {
    try {
      chrome.tabs.get(details.sourceTabId, (tab) => {
        if (tab && tab.url && tab.url.includes('localhost:3000')) {
          _searchPopupTabId = details.tabId;
          console.log("[Background] Search popup tab tracked:", _searchPopupTabId);
        }
      });
    } catch(e) {}
  }
});

// Reset popup tab tracking when that tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === _searchPopupTabId) {
    _searchPopupTabId = null;
  }
});

async function getReusableSearchPopupTabId(pageUrl) {
  if (!Number.isFinite(_searchPopupTabId)) return null;
  try {
    const tab = await chrome.tabs.get(_searchPopupTabId);
    if (!tab?.url || !pageUrl) return null;
    if (samePageUrl(tab.url, pageUrl)) {
      return _searchPopupTabId;
    }
    return null;
  } catch {
    return null;
  }
}

// Restore sniffer state on startup
chrome.storage.local.get('snifferActive', (result) => {
  _snifferActive = result?.snifferActive === true;
});

// Check if URL is a valid media playlist (not a .ts segment)
function isValidMediaUrlSniffer(url) {
  if (!url) return false;
  // Skip .ts segments
  if (/\.ts(?:\?|$)/i.test(url)) return false;
  // Accept .m3u8 and .mp4
  if (/\.m3u8(?:\?|$)/i.test(url)) return true;
  if (/\.mp4(?:\?|$)/i.test(url)) return true;
  return false;
}

function isExtensionPageUrl(value) {
  return /^chrome-extension:\/\//i.test(String(value || ""));
}

function isMediaLikePageUrl(value) {
  const text = String(value || "");
  return /(?:stream|crimson|red|indigo)\.voidboost\.cc|\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(text);
}

// Sniff media URLs (m3u8/mp4) from sites the user visits in the popup
// and forward them to our UI page for playback.
// Only active when user explicitly enables it via the sniffer toggle button.
// Skip requests from our own page (localhost:3000) to avoid loops.
const MEDIA_SNIFFER_UI_CACHE = new Set();
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const tabId = details.tabId;
    if (Number.isFinite(tabId) && RESOLVER_TAB_IDS.has(tabId)) {
      return;
    }

    if (
      isExtensionPageUrl(details.initiator) ||
      isExtensionPageUrl(details.documentUrl) ||
      isExtensionPageUrl(details.originUrl)
    ) {
      return;
    }

    // Skip requests initiated by our own UI page to avoid loops
    if (details.initiator && details.initiator.includes('localhost:3000')) {
      return;
    }
    if (details.documentUrl && details.documentUrl.includes('localhost:3000')) {
      return;
    }

    // Always sniff from the search popup (opened via "Search" button).
    // Support tabId === -1 for media requests triggered directly by Chrome's media subsystem on the popup tab.
    const isSearchPopup = (tabId > 0 && tabId === _searchPopupTabId) || (_searchPopupTabId !== null && tabId === -1);

    // Gate: only sniff when user explicitly enabled it (or it's the search popup)
    if (!_snifferActive && !isSearchPopup) return;

    const url = details.url || '';
    if (!isValidMediaUrlSniffer(url)) return;

    // Skip URLs from our own player (localhost:3000)
    if (tabId > 0 && MEDIA_SNIFFER_UI_CACHE.has(tabId)) return;

    console.log("[Background] Media URL sniffed:", url.substring(0, 100));

    chrome.tabs.query({}, (allTabs) => {
      if (!allTabs || !allTabs.length) return;
      const uiTabs = allTabs.filter(t => t.status === 'complete' && t.url && t.url.includes('localhost:3000'));

      // Cache UI tab IDs to skip them on future requests
      for (const tab of uiTabs) {
        MEDIA_SNIFFER_UI_CACHE.add(tab.id);
      }

      // Check if this request is from our own UI tab
      if (uiTabs.some(t => t.id === tabId)) return;

      const pickSourcePageUrl = (...candidates) => {
        for (const candidate of candidates) {
          if (typeof candidate !== "string" || !candidate) continue;
          if (candidate.includes("localhost:3000")) continue;
          if (isMediaLikePageUrl(candidate)) continue;
          return candidate;
        }
        return null;
      };

      const dispatch = async (sourcePageUrl, sourceTabId = null) => {
        const resolvedSourcePageUrl = pickSourcePageUrl(sourcePageUrl, details.documentUrl, details.originUrl, details.initiator);
        let seriesContext = getCachedSeriesContext(resolvedSourcePageUrl);

        if (!seriesContext && Number.isFinite(sourceTabId) && resolvedSourcePageUrl) {
          try {
            seriesContext = await extractSeriesContextFromPage(sourceTabId, resolvedSourcePageUrl);
            if (seriesContext) {
              cacheSeriesContext(resolvedSourcePageUrl, seriesContext);
            }
          } catch {
            seriesContext = null;
          }
        }

        void forwardMediaToUi(url, resolvedSourcePageUrl || url, seriesContext, resolvedSourcePageUrl || url, sourceTabId);
      };

      if (typeof tabId === "number" && tabId > 0) {
        chrome.tabs.get(tabId, (tab) => {
          const sourcePageUrl = pickSourcePageUrl(tab?.url, details.documentUrl, details.originUrl, details.initiator);
          void dispatch(sourcePageUrl, tabId);
        });
        return;
      }

      const fallbackSourceTabId = Number.isFinite(_searchPopupTabId) ? _searchPopupTabId : null;
      void dispatch(pickSourcePageUrl(details.documentUrl, details.originUrl, details.initiator), fallbackSourceTabId);
    });
  },
  { urls: ["<all_urls>"] },
  []
);

// Forward media URL found by content-script (from XHR interception, video elements, etc.)
async function forwardMediaToUi(mediaUrl, pageUrl, seriesContext, sourcePageUrl = null, sourceTabId = null) {
  const signature = buildMediaForwardSignature(mediaUrl, pageUrl, seriesContext, sourcePageUrl);
  const now = Date.now();
  const lastSeen = FORWARDED_MEDIA_CACHE.get(signature) || 0;
  if (now - lastSeen < FORWARDED_MEDIA_DEDUP_MS) {
    return;
  }
  FORWARDED_MEDIA_CACHE.set(signature, now);

  let resolvedMediaUrl = mediaUrl;
  let resolvedMasterPlaylistUrl = null;
  let resolvedSeriesContext = seriesContext || null;
  const availableQualities = resolvedSeriesContext?.availableQualities;
  let hlsQualities = null;

  if (/\.m3u8(?:\?|$)/i.test(mediaUrl) && (!Array.isArray(availableQualities) || availableQualities.length === 0)) {
    const qualityResolved = await resolveBestQualityHls(mediaUrl);
    if (qualityResolved?.variants?.length) {
      resolvedMediaUrl = qualityResolved.url || mediaUrl;
      resolvedMasterPlaylistUrl = qualityResolved.masterUrl || null;
      hlsQualities = qualityResolved.variants;
    }
  }

  if (!resolvedSeriesContext && Number.isFinite(sourceTabId)) {
    const resolverPageUrl = sourcePageUrl || pageUrl;
    resolvedSeriesContext = getCachedSeriesContext(resolverPageUrl);
    if (!resolvedSeriesContext && resolverPageUrl && !isMediaLikePageUrl(resolverPageUrl)) {
      try {
        resolvedSeriesContext = await extractSeriesContextFromPage(sourceTabId, resolverPageUrl);
        if (resolvedSeriesContext) {
          cacheSeriesContext(resolverPageUrl, resolvedSeriesContext);
        }
      } catch {
        resolvedSeriesContext = null;
      }
    }
  }

  if (resolvedSeriesContext && hlsQualities?.length) {
    resolvedSeriesContext = {
      ...resolvedSeriesContext,
      masterPlaylistUrl: resolvedMasterPlaylistUrl,
      availableQualities: hlsQualities.map((variant) => ({
        label: String(variant.label || "").trim(),
        normalizedLabel: String(variant.label || "").toLowerCase().replace(/[^a-z0-9]/g, "")
      })),
      selectedQualityLabel: resolvedSeriesContext.selectedQualityLabel || pickHighestStreamOption(hlsQualities)?.label || null
    };
  }

  if (
    (!Array.isArray(resolvedSeriesContext?.availableQualities) || resolvedSeriesContext.availableQualities.length === 0) &&
    Number.isFinite(sourceTabId) &&
    resolvedSeriesContext?.resolver?.provider === "rezka"
  ) {
    const fallbackEpisode = Array.isArray(resolvedSeriesContext.episodes)
      ? resolvedSeriesContext.episodes[Number(resolvedSeriesContext.currentEpisodeIndex) || 0]
      : null;
    const targetEpisode = {
      seasonId: resolvedSeriesContext.currentSeasonId ?? fallbackEpisode?.seasonId,
      episodeId: resolvedSeriesContext.currentEpisodeId ?? fallbackEpisode?.episodeId
    };
    if (Number.isFinite(Number(targetEpisode.seasonId)) && Number.isFinite(Number(targetEpisode.episodeId))) {
      const ajaxData = await fetchRezkaEpisodeMediaInTab(sourceTabId, resolvedSeriesContext, targetEpisode, {
        translatorId: resolvedSeriesContext.selectedTranslatorId
      });
      const streamOptions = ajaxData?.url ? parseRezkaStreamOptions(ajaxData.url) : [];
      if (streamOptions.length > 0) {
        const highestStream = pickHighestStreamOption(streamOptions);
        if (highestStream?.url) {
          resolvedMediaUrl = highestStream.url;
        }
        resolvedSeriesContext = {
          ...resolvedSeriesContext,
          availableQualities: streamOptions.map((option) => ({
            label: option.label,
            normalizedLabel: option.normalizedLabel
          })),
          selectedQualityLabel: resolvedSeriesContext.selectedQualityLabel || highestStream?.label || null
        };
      }
    }
  }

  console.log("[Background] Forwarding media from content-script:", {
    mediaUrl: mediaUrl.substring(0, 100),
    qualities: Array.isArray(resolvedSeriesContext?.availableQualities) ? resolvedSeriesContext.availableQualities.length : 0,
    resolver: resolvedSeriesContext?.resolver?.provider || null
  });
  chrome.tabs.query({}, (allTabs) => {
    if (!allTabs) return;
    allTabs.filter(t => t.status === 'complete' && t.url && t.url.includes('localhost:3000'))
      .forEach(tab => {
        sendTabMessage(tab.id, {
          type: "WT_MEDIA_FOUND",
          payload: {
            roomId: null,
            mediaUrl: resolvedMediaUrl,
            masterPlaylistUrl: resolvedMasterPlaylistUrl,
            pageUrl: pageUrl || mediaUrl,
            sourcePageUrl: sourcePageUrl || pageUrl || mediaUrl,
            seriesContext: resolvedSeriesContext
          }
        });
      });
  });
}

// Also poll for pending media URLs from content-script (via storage)
let _lastForwardedPendingMediaTimestamp = 0;
function keepAlive() {
  setInterval(() => {
    chrome.storage.local.get(["pendingMediaUrl", "keepAlive"], (result) => {
      const pending = result.pendingMediaUrl;
      if (pending && pending.payload && pending.payload.mediaUrl) {
        const age = Date.now() - (pending.timestamp || 0);
        if (age < 60000 && pending.timestamp !== _lastForwardedPendingMediaTimestamp) {
          _lastForwardedPendingMediaTimestamp = pending.timestamp || 0;
          chrome.storage.local.remove("pendingMediaUrl", () => void chrome.runtime.lastError);
          if (isResolverPageMediaSuppressed(pending.payload.sourcePageUrl || pending.payload.pageUrl)) {
            return;
          }
          forwardMediaToUi(
            pending.payload.mediaUrl,
            pending.payload.pageUrl,
            pending.payload.seriesContext,
            pending.payload.sourcePageUrl || null,
            null
          );
        }
      }
    });
  }, 5000);
}
keepAlive();

const CS_FORWARD_EVENT = "WT_SEARCH_RESULT_CLICKED";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle sniffer state toggle from UI
  if (message?.type === "WT_SNIFFER_STATE") {
    _snifferActive = message.payload?.active === true;
    try {
      chrome.storage.local.set({ snifferActive: _snifferActive }, () => void chrome.runtime.lastError);
    } catch {
      // Persisting the sniffer toggle is best-effort.
    }
    console.log("[Background] Sniffer state:", _snifferActive ? "ON" : "OFF");
    return;
  }

  // Forward search result clicks from content-script (non-sandboxed pages)
  if (message?.type === CS_FORWARD_EVENT) {
    const url = message?.payload?.url;
    if (url) {
      forwardToUi(url);
    }
    return;
  }

  // Forward media URLs found by content-script (from XHR, video elements on Rezka etc.)
  if (message?.type === "WT_MEDIA_FOUND") {
    if (sender?.tab?.id && RESOLVER_TAB_IDS.has(sender.tab.id)) {
      return;
    }

    const mediaUrl = message?.payload?.mediaUrl;
    const pageUrl = message?.payload?.pageUrl;
    const sourcePageUrl = message?.payload?.sourcePageUrl || null;
    if (isExtensionPageUrl(pageUrl) || isExtensionPageUrl(sourcePageUrl)) {
      return;
    }

    if (isResolverPageMediaSuppressed(sourcePageUrl || pageUrl)) {
      return;
    }

    const cachedSeriesContext = getCachedSeriesContext(sourcePageUrl || pageUrl);
    const seriesContext = message?.payload?.seriesContext || cachedSeriesContext;
    console.log("[Background] Received WT_MEDIA_FOUND from content-script:", mediaUrl?.substring(0, 100));
    if (mediaUrl) {
      if (seriesContext) {
        forwardMediaToUi(mediaUrl, pageUrl, seriesContext, sourcePageUrl, sender?.tab?.id);
      } else if (sender?.tab?.id) {
        extractSeriesContextFromPage(sender.tab.id, pageUrl || sourcePageUrl || mediaUrl)
          .then((resolvedSeriesContext) => {
            const nextSeriesContext = resolvedSeriesContext || cachedSeriesContext || null;
            if (pageUrl && nextSeriesContext) {
              cacheSeriesContext(pageUrl, nextSeriesContext);
            }
            forwardMediaToUi(mediaUrl, pageUrl, nextSeriesContext, sourcePageUrl, sender?.tab?.id);
          })
          .catch(() => {
            forwardMediaToUi(mediaUrl, pageUrl, null, sourcePageUrl, sender?.tab?.id);
          });
      } else {
        forwardMediaToUi(mediaUrl, pageUrl, null, sourcePageUrl, sender?.tab?.id);
      }
    }
    return;
  }

  if (message?.type === SERIES_CONTEXT_FOUND_EVENT) {
    const pageUrl = message?.payload?.pageUrl || message?.payload?.sourcePageUrl || null;
    const seriesContext = message?.payload?.seriesContext || null;
    if (pageUrl && seriesContext) {
      cacheSeriesContext(pageUrl, seriesContext);
    }

    chrome.tabs.query({}, (allTabs) => {
      if (!allTabs) return;
      allTabs
        .filter((tab) => tab.status === "complete" && tab.url && tab.url.includes("localhost:3000"))
        .forEach((tab) => {
          sendTabMessage(tab.id, {
            type: SERIES_CONTEXT_FOUND_EVENT,
            payload: {
              roomId: null,
              pageUrl,
              sourcePageUrl: pageUrl,
              seriesContext
            }
          });
        });
    });
    return;
  }

  if (message?.type !== SEARCH_REQUEST_EVENT && message?.type !== RESOLVE_PAGE_REQUEST_EVENT) return;

  (async () => {
    const hostTabId = sender?.tab?.id ?? null;

    try {
      if (message.type === RESOLVE_PAGE_REQUEST_EVENT) {
        const pageUrl = normalizePageUrl(message.payload.pageUrl);
        if (!pageUrl) {
          sendError(hostTabId, "Invalid page URL");
          sendResponse({ ok: false, error: "Invalid page URL" });
          return;
        }

        const reuseTabId = await getReusableSearchPopupTabId(pageUrl);
        const resolved = await resolvePageToMediaOnce(pageUrl, hostTabId, "Opening page", {
          ...(message.payload.targetEpisode || {}),
          seriesContext: message.payload.seriesContext || null,
          selectedTranslatorId: message.payload.selectedTranslatorId ?? null,
          selectedQualityLabel: message.payload.selectedQualityLabel ?? null
        }, reuseTabId);
        if (!resolved?.mediaUrl) {
          sendError(hostTabId, "No media URL captured");
          sendResponse({ ok: false, error: "No media URL captured" });
          return;
        }

        sendResponse({
          ok: true,
          mediaUrl: resolved.mediaUrl,
          masterPlaylistUrl: resolved.masterPlaylistUrl || null,
          pageUrl: resolved.pageUrl,
          seriesContext: resolved.seriesContext || null
        });
        return;
      }

      sendStatus(hostTabId, "Searching public web results");

      const resultUrls = await getSearchCandidates(message.payload.query, hostTabId);
      if (!resultUrls.length) {
        sendError(hostTabId, "No search result found");
        sendResponse({ ok: false, error: "No search result found" });
        return;
      }

      for (const [index, resultUrl] of resultUrls.entries()) {
        sendStatus(hostTabId, `Trying candidate ${index + 1}/${resultUrls.length}: ${resultUrl}`);

        const resolved = await resolvePageToMediaOnce(resultUrl, hostTabId, "Opening page", null);
        if (resolved?.mediaUrl) {
          sendResponse({
            ok: true,
            mediaUrl: resolved.mediaUrl,
            masterPlaylistUrl: resolved.masterPlaylistUrl || null,
            pageUrl: resolved.pageUrl,
            seriesContext: resolved.seriesContext || null
          });
          return;
        }

        sendStatus(hostTabId, "No media on this candidate, trying next one");
      }

      sendError(hostTabId, "No media URL captured");
      sendResponse({ ok: false, error: "No media URL captured" });
    } catch (error) {
      sendError(hostTabId, String(error));
      sendResponse({ ok: false, error: String(error) });
    }
  })();

  return true;
});
