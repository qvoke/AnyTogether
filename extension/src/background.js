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

function parseRezkaStreamOptions(streamText) {
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

function pickRezkaStreamOption(options, preferredQualityLabel, defaultQualityLabel) {
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

  // Важно: многие источники возвращают default_quality/data.quality как "360p", даже когда доступны 720/1080.
  // Если пользователь не задал качество явно — выбираем максимально доступное по метке.
  const ranked = options
    .map((option) => ({ option, resolution: parseResolution(option.label) ?? parseResolution(option.normalizedLabel) ?? 0 }))
    .sort((a, b) => b.resolution - a.resolution);

  if (ranked.length && ranked[0].resolution > 0) {
    return ranked[0].option;
  }

  // Fallback: сохраним старое поведение на случай нестандартных меток.
  const defaultMatch = normalizeQualityLabel(defaultQualityLabel);
  if (defaultMatch) {
    const exactDefault = options.find((option) => option.normalizedLabel === defaultMatch);
    if (exactDefault) return exactDefault;
  }

  return options[0];
}

async function fetchRezkaEpisodeMedia(seriesContext, targetEpisode, options = {}) {
  const resolver = seriesContext?.resolver;
  if (!resolver || resolver.provider !== "rezka") {
    return null;
  }

  const itemId = Number(resolver.itemId);
  const translatorId = Number(
    Number.isFinite(Number(options.translatorId)) ? options.translatorId : resolver.translatorId
  );
  const seasonId = Number(targetEpisode?.seasonId);
  const episodeId = Number(targetEpisode?.episodeId);

  if (!Number.isFinite(itemId) || !Number.isFinite(translatorId) || !Number.isFinite(seasonId) || !Number.isFinite(episodeId)) {
    return null;
  }

  const origin = resolver.origin || "https://rezka-ua.tv";
  const endpoint = new URL("/ajax/get_cdn_series/", origin);
  endpoint.searchParams.set("t", String(Date.now()));

  const response = await fetch(endpoint.href, {
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

  if (!response.ok) {
    return null;
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const streamOptions = parseRezkaStreamOptions(data?.url || "");
  const selectedStream = pickRezkaStreamOption(
    streamOptions,
    options.qualityLabel || data?.quality,
    data?.default_quality
  );

  if (!selectedStream?.url) {
    return null;
  }

  const episodes = Array.isArray(seriesContext?.episodes) ? seriesContext.episodes : [];
  const currentEpisodeIndex = episodes.findIndex(
    (episode) => Number(episode?.seasonId) === seasonId && Number(episode?.episodeId) === episodeId
  );

  // Debug: log what quality was selected and what URLs are available
  console.log("[AnyTogether Rezka Resolver]", {
    requestedQuality: options.qualityLabel || data?.quality,
    selectedLabel: selectedStream.label,
    selectedUrl: selectedStream.url ? selectedStream.url.substring(0, 100) + '...' : 'NONE',
    allOptionsCount: streamOptions.length,
    allOptions: streamOptions.map(o => ({ label: o.label, url: o.url.substring(0, 50) + '...' }))
  });

  return {
    mediaUrl: selectedStream.url,
    pageUrl: resolver.pageUrl || null,
    seriesContext: {
      ...seriesContext,
      currentEpisodeIndex,
      currentSeasonId: seasonId,
      currentEpisodeId: episodeId,
      selectedTranslatorId: translatorId,
      selectedQualityLabel: selectedStream.label,
      availableQualities: streamOptions.map((streamOption) => ({
        label: streamOption.label,
        normalizedLabel: streamOption.normalizedLabel
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
 * 1. Fetch the URL — if it's a master playlist, extract best variant
 * 2. If it's a media playlist, try common master playlist names in same dir
 * 3. Return the best quality media URL + master URL for hls.js
 */
// Определяет, выглядит ли имя файла как master playlist
function isMasterByFilename(filename) {
  const base = filename.split('?')[0].split('#')[0].toLowerCase();
  // Имена, типичные для master playlist
  if (/^(master|index|playlist|manifest|multi|variant|adaptive)/i.test(base)) return true;
  // Не содержит цифр качества (360p, 720p, 1080, 1920x1080)
  if (!/\d{3,4}p?/.test(base) && !/_\d+x\d+/.test(base)) return true;
  return false;
}

// Парсит имя файла media playlist на предмет разрешения (например, 720p, 1080, 1920x1080)
function guessResolutionFromFilename(filename) {
  const base = filename.split('?')[0].split('#')[0];
  // 1080p, 720p, 360p
  const labeled = base.match(/(\d{3,4})\s*p/i);
  if (labeled) return parseInt(labeled[1], 10);
  // 1920x1080, 1280x720
  const dims = base.match(/(\d+)x(\d+)/i);
  if (dims) return parseInt(dims[2], 10);
  // Просто число (1080, 720)
  const number = base.match(/(\d{3,4})(?:\.[^.]+)?$/);
  if (number) return parseInt(number[1], 10);
  return 0;
}

// Выбирает наилучший .m3u8 из списка по имени файла
function pickBestM3u8ByFilename(urls) {
  if (!urls || urls.length === 0) return null;
  
  // Сортируем: сначала master по имени, потом media по убыванию разрешения
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

  // Пробуем загрузить через fetch (если CORS разрешён)
  // Если не получилось — пытаемся угадать master playlist по имени файла
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

  // Попробуем найти master по разным именам в той же директории
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

  // Если fetch не сработал (CORS) — пытаемся угадать master по имени файла
  const best = pickBestM3u8ByFilename([mediaUrl]);
  if (best && best.isMaster) {
    return { url: best.url, masterUrl: best.url, variants: null };
  }

  // Если у нас media playlist с известным разрешением — отдаём как есть
  if (result1) return result1;

  // Fallback: исходный URL как есть
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
      
      // Отфильтровываем .m3u8 — среди них ищем master
      const m3u8Urls = [...new Set(collectedUrls.filter(url => /\.m3u8/i.test(url)))];
      const mp4Urls = [...new Set(collectedUrls.filter(url => /\.mp4/i.test(url)))];
      
      // 1. Сначала пробуем каждый .m3u8 — может быть master playlist
      if (m3u8Urls.length > 0) {
        // Пробуем загрузить каждый .m3u8 и проверить, не master ли он
        for (const url of m3u8Urls) {
          const resolved = await resolveBestQualityHls(url);
          if (resolved?.masterUrl || resolved?.variants) {
            // Это master playlist! Отдаём его URL
            resolve(resolved.masterUrl || url);
            return;
          }
        }
        // Ни один не оказался master — отдаём media playlist с наивысшим разрешением
        // (resolveBestQualityHls уже попытался найти master рядом)
        for (const url of m3u8Urls) {
          const resolved = await resolveBestQualityHls(url);
          if (resolved?.url) {
            resolve(resolved.url);
            return;
          }
        }
        // Fallback: первый .m3u8
        resolve(m3u8Urls[0]);
        return;
      }
      
      // 2. .mp4 файлы
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

        /**
         * Загружает .m3u8 (без CORS проблем, т.к. внутри страницы)
         * и определяет master это или media playlist.
         * Возвращает { isMaster, variants } или null.
         */
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
              // Парсим варианты качества
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

        // Собираем все URL
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

        // Из video/source/meta
        document.querySelectorAll("video, video source, source, meta").forEach((node) => {
          if (node.tagName === "VIDEO") { addUrl(node.currentSrc); addUrl(node.src); }
          if (node.tagName === "SOURCE") { addUrl(node.src); }
          if (node.tagName === "META") { addUrl(node.content); }
        });

        // Из скриптов
        for (const script of document.scripts) {
          const text = script.textContent || "";
          const escaped = text.match(/https?:\\\/\\\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:[^\s"'<>]*)/gi);
          if (escaped) escaped.forEach(m => addUrl(m.replace(/\\\//g, '/')));
          const plain = text.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi);
          if (plain) plain.forEach(addUrl);
        }

        // Из HTML
        const html = document.documentElement.innerHTML;
        const htmlEscaped = html.match(/https?:\\\/\\\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:[^\s"'<>]*)/gi);
        if (htmlEscaped) htmlEscaped.forEach(m => addUrl(m.replace(/\\\//g, '/')));
        const htmlPlain = html.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi);
        if (htmlPlain) htmlPlain.forEach(addUrl);

        const m3u8List = [...m3u8Urls];

        // 1) Сначала пытаемся загрузить каждый уникальный .m3u8 и проверить — не master ли он
        // Пробуем не более 5 URL для скорости
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

        // 2) Ни один не master — ищем master по имени файла
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

        // 3) Ищем master в той же директории (для media playlist)
        // Известные имена master рядом с media
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

        // 4) Выбираем media playlist с наивысшим разрешением
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

async function extractRezkaCdnUrlTextFromPage(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const looksLikeQualityList = (value) =>
          typeof value === "string" &&
          value.includes("[") &&
          value.includes("]") &&
          /https?:\/\//i.test(value) &&
          /(?:m3u8|mp4)/i.test(value);

        const candidates = [];

        const activeEpisode = document.querySelector(".b-simple_episode__item.active[data-cdn_url]");
        if (activeEpisode) {
          const url = activeEpisode.getAttribute("data-cdn_url");
          if (looksLikeQualityList(url)) {
            candidates.push(url);
          }
        }

        document.querySelectorAll("[data-cdn_url]").forEach((node) => {
          const url = node.getAttribute("data-cdn_url");
          if (looksLikeQualityList(url)) {
            candidates.push(url);
          }
        });

        // Возьмём "самый информативный" (обычно там больше вариантов качества).
        candidates.sort((a, b) => String(b).length - String(a).length);
        return candidates[0] || null;
      }
    });

    return result?.result || null;
  } catch {
    return null;
  }
}

async function extractSeriesContextFromPage(tabId, pageUrl) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        args: [pageUrl],
        func: (pageUrlArg) => {
          // Ждем, пока загрузится хотя бы базовый контент страницы
          if (document.readyState === "loading" || !document.body || document.body.innerText.length < 200) {
            return null; // retry
          }

          const normalizeUrl = (value) => {
            try {
              const url = new URL(value, document.baseURI);
              url.hash = "";
              return url.href;
            } catch {
              return null;
            }
          };

          const title =
            document.querySelector('meta[property="og:title"]')?.content?.trim() ||
            document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
            document.title.replace(/\s+/g, " ").trim();
          const currentPageUrl = normalizeUrl(pageUrlArg) || document.location.href;
          const html = document.documentElement.innerHTML;
          const resolverMatch = html.match(/initCDNSeriesEvents\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),/i);
          const favs = document.querySelector("#ctrl_favs")?.value || "";
          
          const isRezka = /rezka/i.test(currentPageUrl);
          const isSeries = isRezka && !!resolverMatch;

          const resolver = resolverMatch
            ? {
                provider: "rezka",
                itemId: Number(resolverMatch[1]),
                translatorId: Number(resolverMatch[2]),
                pageUrl: currentPageUrl,
                origin: new URL(currentPageUrl).origin,
                favs,
                contentType: "series"
              }
            : null;

          const seasonItems = [...document.querySelectorAll("#simple-seasons-tabs .b-simple_season__item")];
          const episodeLists = [...document.querySelectorAll("#simple-episodes-tabs .b-simple_episodes__list")];
          const translatorItems = [...document.querySelectorAll("#translators-list .b-translator__item")];
          const selectedTranslator = document.querySelector("#translators-list .b-translator__item.active");
          const selectedTranslatorId = selectedTranslator ? Number(selectedTranslator.getAttribute("data-translator_id")) : null;
          const selectedTranslatorTitle = (selectedTranslator?.getAttribute("title") || selectedTranslator?.textContent || "").replace(/\s+/g, " ").trim();

          const activeEpisode = document.querySelector("#simple-episodes-tabs .b-simple_episode__item.active") || 
                                document.querySelector(".b-simple_episode__item.active");
          const activeSeason = document.querySelector("#simple-seasons-tabs .b-simple_season__item.active");
          const fallbackSeasonId = seasonItems[0] ? Number(seasonItems[0].getAttribute("data-tab_id")) : null;

          // Сценарий 1: Сериал с несколькими сезонами
          if (seasonItems.length > 0 && episodeLists.length > 0) {
            const seasons = [];
            const flatEpisodes = [];

            for (const seasonItem of seasonItems) {
              const seasonId = Number(seasonItem.getAttribute("data-tab_id"));
              if (!Number.isFinite(seasonId)) continue;
              const seasonTitle = (seasonItem.textContent || "").replace(/\s+/g, " ").trim();

              const seasonEpisodes = [...document.querySelectorAll(`#simple-episodes-list-${seasonId} .b-simple_episode__item`)];
              const seasonEpisodeItems = [];
              for (const episodeItem of seasonEpisodes) {
                const episodeId = Number(episodeItem.getAttribute("data-episode_id"));
                if (!Number.isFinite(episodeId)) continue;
                const episodeTitle = (episodeItem.textContent || "").replace(/\s+/g, " ").trim();
                const episode = {
                  title: episodeTitle,
                  seasonId,
                  episodeId
                };

                seasonEpisodeItems.push(episode);
                flatEpisodes.push(episode);
              }

              seasons.push({
                seasonId,
                title: seasonTitle,
                episodes: seasonEpisodeItems
              });
            }

            // Ждем, пока загрузится хотя бы одна серия во flatEpisodes
            if (flatEpisodes.length < 1) {
              return null;
            }

            const activeSeasonId = activeSeason ? Number(activeSeason.getAttribute("data-tab_id")) : fallbackSeasonId;
            const activeEpisodeId = activeEpisode ? Number(activeEpisode.getAttribute("data-episode_id")) : flatEpisodes[0]?.episodeId ?? null;
            const currentEpisodeIndex = Number.isFinite(activeSeasonId) && Number.isFinite(activeEpisodeId)
              ? flatEpisodes.findIndex(
                  (episode) => episode.seasonId === activeSeasonId && episode.episodeId === activeEpisodeId
                )
              : 0;
            const normalizedEpisodeIndex = currentEpisodeIndex >= 0 ? currentEpisodeIndex : 0;

            console.log("[Background] Series context extracted", {
              pageUrl: currentPageUrl,
              title,
              seasonCount: seasons.length,
              episodeCount: flatEpisodes.length,
              translatorCount: translatorItems.length,
              currentSeasonId: Number.isFinite(activeSeasonId) ? activeSeasonId : null,
              currentEpisodeId: Number.isFinite(activeEpisodeId) ? activeEpisodeId : null
            });
            console.log("[Background] Series seasons", seasons.map((season) => ({
              seasonId: season.seasonId,
              title: season.title,
              episodeCount: Array.isArray(season.episodes) ? season.episodes.length : 0
            })));

            return {
              title: title || null,
              currentPageUrl,
              currentSeasonId: Number.isFinite(activeSeasonId) ? activeSeasonId : null,
              currentEpisodeId: Number.isFinite(activeEpisodeId) ? activeEpisodeId : null,
              currentEpisodeIndex: normalizedEpisodeIndex,
              seasons,
              episodes: flatEpisodes,
              translators: translatorItems
                .map((item) => {
                  const translatorId = Number(item.getAttribute("data-translator_id"));
                  if (!Number.isFinite(translatorId)) return null;

                  return {
                    translatorId,
                    title: (item.getAttribute("title") || item.textContent || "").replace(/\s+/g, " ").trim()
                  };
                })
                .filter(Boolean),
              selectedTranslatorId,
              selectedTranslatorTitle: selectedTranslatorTitle || null,
              resolver
            };
          }
          // Сценарий 2: Сериал с единственным сезоном (вкладок сезонов нет, но список эпизодов есть)
          else if (isSeries) {
            const seasons = [{
              seasonId: 1,
              title: "Season 1",
              episodes: []
            }];
            const flatEpisodes = [];
            
            const seasonEpisodes = [...document.querySelectorAll("#simple-episodes-tabs .b-simple_episode__item")];
            for (const episodeItem of seasonEpisodes) {
              const episodeId = Number(episodeItem.getAttribute("data-episode_id"));
              if (!Number.isFinite(episodeId)) continue;
              const episodeTitle = (episodeItem.textContent || "").replace(/\s+/g, " ").trim();
              const episode = {
                title: episodeTitle,
                seasonId: 1,
                episodeId
              };
              seasons[0].episodes.push(episode);
              flatEpisodes.push(episode);
            }

            if (flatEpisodes.length < 1) {
              return null; // не готово
            }

            const activeEpisodeId = activeEpisode ? Number(activeEpisode.getAttribute("data-episode_id")) : flatEpisodes[0]?.episodeId ?? null;
            const currentEpisodeIndex = Number.isFinite(activeEpisodeId)
              ? flatEpisodes.findIndex((episode) => episode.episodeId === activeEpisodeId)
              : 0;
            const normalizedEpisodeIndex = currentEpisodeIndex >= 0 ? currentEpisodeIndex : 0;

            console.log("[Background] Series context extracted", {
              pageUrl: currentPageUrl,
              title,
              seasonCount: seasons.length,
              episodeCount: flatEpisodes.length,
              translatorCount: translatorItems.length,
              currentSeasonId: 1,
              currentEpisodeId: Number.isFinite(activeEpisodeId) ? activeEpisodeId : null
            });
            console.log("[Background] Series seasons", seasons.map((season) => ({
              seasonId: season.seasonId,
              title: season.title,
              episodeCount: Array.isArray(season.episodes) ? season.episodes.length : 0
            })));

            return {
              title: title || null,
              currentPageUrl,
              currentSeasonId: 1,
              currentEpisodeId: activeEpisodeId,
              currentEpisodeIndex: normalizedEpisodeIndex,
              seasons,
              episodes: flatEpisodes,
              translators: translatorItems
                .map((item) => {
                  const translatorId = Number(item.getAttribute("data-translator_id"));
                  if (!Number.isFinite(translatorId)) return null;
                  return {
                    translatorId,
                    title: (item.getAttribute("title") || item.textContent || "").replace(/\s+/g, " ").trim()
                  };
                })
                .filter(Boolean),
              selectedTranslatorId,
              selectedTranslatorTitle: selectedTranslatorTitle || null,
              resolver
            };
          }

          // Если это rezka, но сезонов/эпизодов нет (фильм, клип, шоу) — всё равно вернём минимальный контекст,
          // чтобы расширение могло вытащить список качеств из data-cdn_url.
          if (resolver) {
            return {
              title: title || null,
              currentPageUrl,
              currentSeasonId: null,
              currentEpisodeId: null,
              currentEpisodeIndex: null,
              seasons: [],
              episodes: [],
              translators: translatorItems
                .map((item) => {
                  const translatorId = Number(item.getAttribute("data-translator_id"));
                  if (!Number.isFinite(translatorId)) return null;
                  return {
                    translatorId,
                    title: (item.getAttribute("title") || item.textContent || "").replace(/\s+/g, " ").trim()
                  };
                })
                .filter(Boolean),
              selectedTranslatorId,
              selectedTranslatorTitle: selectedTranslatorTitle || null,
              resolver: {
                ...resolver,
                contentType: resolver.contentType || "movie"
              }
            };
          }

          const currentUrl = new URL(currentPageUrl);
          const currentTitleTokens = (
            document.querySelector('meta[property="og:title"]')?.content?.trim() ||
            document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
            document.title.replace(/\s+/g, " ").trim()
          )
            .toLowerCase()
            .split(/[^a-z0-9\u0440-\u044f\u0451]+/i)
            .map((token) => token.trim())
            .filter((token) => token.length >= 3)
            .slice(0, 8);
          const samePage = (left, right) => {
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
          };

          const selectors = [
            "a[href]",
            "li a[href]",
            "nav a[href]",
            "article a[href]",
            "section a[href]",
            "main a[href]"
          ];

          const anchors = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
          const seen = new Set();
          const episodes = [];

          for (const anchor of anchors) {
            const rawHref = anchor.getAttribute("href");
            const href = normalizeUrl(rawHref);
            if (!href || seen.has(href)) continue;

            const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
            if (!text) continue;

            let score = 0;
            const combined = `${text} ${href}`.toLowerCase();
            const currentSegments = new URL(currentPageUrl).pathname.split("/").filter(Boolean);
            const candidateSegments = new URL(href).pathname.split("/").filter(Boolean);
            const containerText = (anchor.closest("li, article, section, div")?.innerText || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            let prefixCount = 0;

            while (prefixCount < currentSegments.length && prefixCount < candidateSegments.length) {
              if (currentSegments[prefixCount] !== candidateSegments[prefixCount]) break;
              prefixCount += 1;
            }

            if (prefixCount < currentSegments.length) continue;

            score += prefixCount * 4;

            const episodeLike =
              /(season\s*\d+|episode\s*\d+|ep\.?\s*\d+|s\d+\s*e\d+|s\d+e\d+|[\p{Script=Cyrillic}]+\s*\d+)/iu.test(combined) ||
              /(season\s*\d+|episode\s*\d+|ep\.?\s*\d+|s\d+\s*e\d+|s\d+e\d+|[\p{Script=Cyrillic}]+\s*\d+)/iu.test(containerText);

            if (!episodeLike) continue;

            if (currentTitleTokens.some((token) => combined.includes(token) || containerText.includes(token))) {
              score += 8;
            }

            if (/\bseason\b/i.test(combined) || /[\p{Script=Cyrillic}]+\s*\d+/iu.test(combined)) score += 2;
            if (/\bepisode\b/i.test(combined) || /[\p{Script=Cyrillic}]+\s*\d+/iu.test(combined)) score += 2;
            if (/\bep\.?\b/i.test(combined)) score += 2;
            if (/\b\d+\b/.test(text)) score += 1;
            if (text.length <= 120) score += 1;

            try {
              const url = new URL(href);
              if (url.hash) continue;
              if (url.origin === currentUrl.origin) score += 2;
              if (samePage(url.href, currentPageUrl)) score += 8;
            } catch {
              continue;
            }

            if (anchor.closest("nav, ul, ol, section, article, main")) {
              score += 1;
            }

            if (score < 5) continue;

            episodes.push({ href, text, score });
            seen.add(href);
          }

          const episodeItems = episodes.slice(0, 24).map((item) => ({
            title: item.text,
            url: item.href
          }));

          if (episodeItems.length < 1) return null;

          const currentEpisodeIndex = episodeItems.findIndex((episode) => samePage(episode.url, currentPageUrl));

          return {
            title: title || null,
            currentPageUrl,
            currentEpisodeIndex,
            episodes: episodeItems,
            seasons: [],
            translators: [],
            selectedTranslatorId: null,
            selectedTranslatorTitle: null,
            resolver
          };
        }
      });

      if (result?.result) {
        if (result.result.notSeries) {
          return null; // Прекращаем цикл ожидания для фильмов/не-сериалов
        }
        return result.result;
      }
    } catch (e) {
      console.error("[Background] Error in extractSeriesContextFromPage attempt:", attempt, e);
    }
    await delay(1000);
  }

  return null;
}

async function fetchRezkaEpisodeMediaInTab(tabId, seriesContext, targetEpisode, options = {}) {
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
    console.error("[Background] Error in fetchRezkaEpisodeMediaInTab:", e);
    return null;
  }
}

async function activateTargetEpisodeOnPage(tabId, targetEpisode) {
  const seasonId = Number(targetEpisode?.seasonId);
  const episodeId = Number(targetEpisode?.episodeId);

  if (!Number.isFinite(seasonId) || !Number.isFinite(episodeId)) {
    return false;
  }

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [{ seasonId, episodeId }],
      func: (target) => {
        const seasonButton = document.querySelector(`#simple-seasons-tabs .b-simple_season__item[data-tab_id="${target.seasonId}"]`);
        const episodeButton = document.querySelector(
          `#simple-episodes-list-${target.seasonId} .b-simple_episode__item[data-season_id="${target.seasonId}"][data-episode_id="${target.episodeId}"]`
        );

        if (!episodeButton) {
          return { ok: false, reason: "episode-missing" };
        }

        if (seasonButton && !seasonButton.classList.contains("active")) {
          seasonButton.click();
          return { ok: false, reason: "season-switch" };
        }

        if (!episodeButton.classList.contains("active")) {
          episodeButton.click();
          return { ok: true };
        }

        return { ok: true };
      }
    });

    if (result?.result?.ok) {
      return true;
    }

    await delay(1000);
  }

  return false;
}

async function resolvePageToMedia(pageUrl, hostTabId, statusPrefix, targetEpisode = null, reuseTabId = null) {
  const createdTab = !Number.isFinite(reuseTabId);
  const tabId = createdTab ? (await chrome.tabs.create({ url: "about:blank", active: false })).id : reuseTabId;
  const mediaCapture = waitForMediaUrl(tabId);

  try {
    sendStatus(hostTabId, `${statusPrefix}: ${pageUrl}`);
    sendStatus(hostTabId, "Clearing saved playback state");
    await clearOriginSiteData(pageUrl);
    await chrome.tabs.update(tabId, { url: pageUrl });
    await delay(3000);

    const currentTab = await chrome.tabs.get(tabId);
    const currentPageUrl = typeof currentTab.url === "string" ? currentTab.url : pageUrl;

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
    } else if (/rezka/i.test(currentPageUrl)) {
      sendStatus(hostTabId, "Series context not found on page");
    }

    let mediaUrl = null;
    let masterUrl = null;

    // Сценарий 1: Пользователь переключил серию/сезон/перевод
    if (targetEpisode) {
      const activeContext = targetEpisode.seriesContext || seriesContext;
      const isRezka = activeContext?.resolver?.provider === "rezka" || /rezka/i.test(currentPageUrl);

      if (isRezka) {
        sendStatus(hostTabId, "Fetching episode stream directly via tab context");
        const ajaxData = await fetchRezkaEpisodeMediaInTab(tabId, activeContext, targetEpisode, {
          translatorId: targetEpisode.selectedTranslatorId,
          qualityLabel: targetEpisode.selectedQualityLabel
        });

        if (ajaxData?.url) {
          const streamOptions = parseRezkaStreamOptions(ajaxData.url);
          const selectedStream = pickRezkaStreamOption(
            streamOptions,
            targetEpisode.selectedQualityLabel || ajaxData.quality,
            ajaxData.default_quality
          );

          if (selectedStream?.url) {
            sendStatus(hostTabId, "Media URL captured from tab AJAX fetch");
            const episodes = Array.isArray(activeContext?.episodes) ? activeContext.episodes : [];
            const currentEpisodeIndex = episodes.findIndex(
              (episode) => Number(episode?.seasonId) === Number(targetEpisode.seasonId) && Number(episode?.episodeId) === Number(targetEpisode.episodeId)
            );

            return {
              mediaUrl: selectedStream.url,
              masterPlaylistUrl: null,
              pageUrl: pageUrl,
              seriesContext: {
                ...activeContext,
                currentEpisodeIndex,
                currentSeasonId: Number(targetEpisode.seasonId),
                currentEpisodeId: Number(targetEpisode.episodeId),
                selectedTranslatorId: Number(targetEpisode.selectedTranslatorId || activeContext?.resolver?.translatorId),
                selectedQualityLabel: selectedStream.label,
                availableQualities: streamOptions.map((o) => ({ label: o.label, normalizedLabel: o.normalizedLabel }))
              }
            };
          }
        }
      }

      // Если это не Rezka или AJAX запрос во вкладке не удался, кликаем кнопки через DOM
      sendStatus(hostTabId, `Selecting episode: S${targetEpisode.seasonId} E${targetEpisode.episodeId}`);
      const activated = await activateTargetEpisodeOnPage(tabId, targetEpisode);
      if (!activated) {
        sendError(hostTabId, "Episode selection failed");
        return null;
      }
      await delay(2000);

      sendStatus(hostTabId, "Sniffing media requests");
      mediaUrl = await mediaCapture.promise;

      if (!mediaUrl) {
        sendStatus(hostTabId, "Falling back to page media extraction");
        const pageResult = await extractMediaUrlFromPage(tabId);
        if (pageResult) {
          mediaUrl = pageResult.mediaUrl || pageResult;
          masterUrl = pageResult.masterPlaylistUrl || null;
        }
      }
    }
    // Сценарий 2: Первая загрузка страницы (поиск/запуск плеера)
    else {
      const isRezka = seriesContext?.resolver?.provider === "rezka" || /rezka/i.test(currentPageUrl);
      if (isRezka) {
        // 1) Пытаемся получить дефолтный стрим серии напрямую через AJAX во вкладке
        const resolverItemId = Number(seriesContext?.resolver?.itemId);
        const currentSeasonId = Number(seriesContext?.currentSeasonId);
        const currentEpisodeId = Number(seriesContext?.currentEpisodeId);

        if (Number.isFinite(resolverItemId) && Number.isFinite(currentSeasonId) && Number.isFinite(currentEpisodeId)) {
          sendStatus(hostTabId, "Fetching default episode stream via tab context");
          const ajaxData = await fetchRezkaEpisodeMediaInTab(tabId, seriesContext, {
            seasonId: currentSeasonId,
            episodeId: currentEpisodeId
          }, {
            translatorId: seriesContext?.selectedTranslatorId ?? seriesContext?.resolver?.translatorId,
            qualityLabel: "1080p"
          });

          if (ajaxData?.url) {
            const streamOptions = parseRezkaStreamOptions(ajaxData.url);
            const selectedStream = pickRezkaStreamOption(
              streamOptions,
              "1080p",
              ajaxData.default_quality
            );

            if (selectedStream?.url) {
              sendStatus(hostTabId, `Rezka stream resolved via tab: ${selectedStream.label}`);
              const episodes = Array.isArray(seriesContext?.episodes) ? seriesContext.episodes : [];
              const currentEpisodeIndex = episodes.findIndex(
                (episode) => Number(episode?.seasonId) === currentSeasonId && Number(episode?.episodeId) === currentEpisodeId
              );

              return {
                mediaUrl: selectedStream.url,
                masterPlaylistUrl: null,
                pageUrl: currentPageUrl,
                seriesContext: {
                  ...seriesContext,
                  currentEpisodeIndex,
                  currentSeasonId,
                  currentEpisodeId,
                  selectedTranslatorId: seriesContext.selectedTranslatorId ?? seriesContext.resolver.translatorId,
                  selectedQualityLabel: selectedStream.label,
                  availableQualities: streamOptions.map((o) => ({ label: o.label, normalizedLabel: o.normalizedLabel }))
                }
              };
            }
          }
        }

        // 2) Fallback: попробуем вытащить data-cdn_url со страницы
        const cdnText = await extractRezkaCdnUrlTextFromPage(tabId);
        const options = parseRezkaStreamOptions(cdnText || "");
        const selected = pickRezkaStreamOption(options, "1080p", null);
        if (selected?.url) {
          const nextSeriesContext = seriesContext && typeof seriesContext === "object" ? { ...seriesContext } : null;
          const qualityResolved = await resolveBestQualityHls(selected.url);
          
          if (nextSeriesContext) {
            nextSeriesContext.selectedQualityLabel = qualityResolved.url !== selected.url ? "best" : selected.label;
            nextSeriesContext.availableQualities = qualityResolved.variants || options.map((option) => ({
              label: option.label,
              normalizedLabel: option.normalizedLabel
            }));
            nextSeriesContext.masterPlaylistUrl = qualityResolved.masterUrl;
          }

          sendStatus(hostTabId, `Rezka cdn_url resolved: ${qualityResolved.url !== selected.url ? 'best quality from master' : selected.label}`);
          return {
            mediaUrl: qualityResolved.url,
            masterPlaylistUrl: qualityResolved.masterUrl,
            pageUrl: currentPageUrl,
            seriesContext: nextSeriesContext
          };
        }
      }

      // Общий fallback (для не-Rezka или если Rezka AJAX не сработал)
      const pageResult = await extractMediaUrlFromPage(tabId);
      if (pageResult) {
        const foundMediaUrl = pageResult.mediaUrl || pageResult;
        const foundMasterUrl = pageResult.masterPlaylistUrl || null;
        
        sendStatus(hostTabId, foundMasterUrl ? "Media URL captured from page (master)" : "Media URL captured from page");
        const qualityResolved = await resolveBestQualityHls(foundMasterUrl || foundMediaUrl);
        
        return {
          mediaUrl: qualityResolved.url,
          masterPlaylistUrl: qualityResolved.masterUrl || foundMasterUrl,
          pageUrl: currentPageUrl,
          seriesContext: qualityResolved.variants ? {
            ...(seriesContext || {}),
            masterPlaylistUrl: qualityResolved.masterUrl || foundMasterUrl,
            availableQualities: qualityResolved.variants.map(v => ({
              label: v.label,
              normalizedLabel: v.label.toLowerCase().replace(/[^a-z0-9]/g, '')
            }))
          } : seriesContext
        };
      }

      sendStatus(hostTabId, "Sniffing media requests");
      mediaUrl = await mediaCapture.promise;
    }

    if (!mediaUrl) {
      return null;
    }

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
    const finalSeriesContext = seriesContext || cachedSeriesContext;

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

// Sniff media URLs (m3u8/mp4) from sites the user visits in the popup
// and forward them to our UI page for playback.
// Only active when user explicitly enables it via the sniffer toggle button.
// Skip requests from our own page (localhost:3000) to avoid loops.
// Sniff media URLs (m3u8/mp4) from sites the user visits in the popup
// and forward them to our UI page for playback.
// Only active when user explicitly enables it via the sniffer toggle button.
// Skip requests from our own page (localhost:3000) to avoid loops.
const MEDIA_SNIFFER_UI_CACHE = new Set();
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const tabId = details.tabId;
    
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

      const isMediaLikePageUrl = (value) => {
        const text = String(value || "");
        return /(?:stream|crimson|red|indigo)\.voidboost\.cc|\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(text);
      };

      const pickSourcePageUrl = (...candidates) => {
        for (const candidate of candidates) {
          if (typeof candidate !== "string" || !candidate) continue;
          if (candidate.includes("localhost:3000")) continue;
          if (isMediaLikePageUrl(candidate)) continue;
          return candidate;
        }
        return null;
      };

      const dispatch = (sourcePageUrl) => {
        const resolvedSourcePageUrl = pickSourcePageUrl(sourcePageUrl, details.documentUrl, details.originUrl, details.initiator);
        for (const tab of uiTabs) {
          sendTabMessage(tab.id, {
            type: "WT_MEDIA_FOUND",
            payload: {
              roomId: null,
              mediaUrl: url,
              masterPlaylistUrl: null,
              pageUrl: resolvedSourcePageUrl || url,
              sourcePageUrl: resolvedSourcePageUrl || url,
              seriesContext: null
            }
          });
        }
      };

      if (typeof tabId === "number" && tabId > 0) {
        chrome.tabs.get(tabId, (tab) => {
          const sourcePageUrl = pickSourcePageUrl(tab?.url, details.documentUrl, details.originUrl, details.initiator);
          dispatch(sourcePageUrl);
        });
        return;
      }

      dispatch(pickSourcePageUrl(details.documentUrl, details.originUrl, details.initiator));
    });
  },
  { urls: ["<all_urls>"] },
  []
);

// Forward media URL found by content-script (from XHR interception, video elements, etc.)
function forwardMediaToUi(mediaUrl, pageUrl, seriesContext, sourcePageUrl = null) {
  console.log("[Background] Forwarding media from content-script:", mediaUrl.substring(0, 100));
  chrome.tabs.query({}, (allTabs) => {
    if (!allTabs) return;
    allTabs.filter(t => t.status === 'complete' && t.url && t.url.includes('localhost:3000'))
      .forEach(tab => {
        sendTabMessage(tab.id, {
          type: "WT_MEDIA_FOUND",
          payload: {
            roomId: null,
            mediaUrl: mediaUrl,
            masterPlaylistUrl: null,
            pageUrl: pageUrl || mediaUrl,
            sourcePageUrl: sourcePageUrl || pageUrl || mediaUrl,
            seriesContext: seriesContext || null
          }
        });
      });
  });
}

// Keep service worker alive — wake it up every 20 seconds
// Also poll for pending media URLs from content-script (via storage)
function keepAlive() {
  setInterval(() => {
    chrome.storage.local.get(['pendingMediaUrl', 'keepAlive'], (result) => {
      const pending = result.pendingMediaUrl;
      if (pending && pending.payload && pending.payload.mediaUrl) {
        const age = Date.now() - (pending.timestamp || 0);
        if (age < 60000) {
          chrome.storage.local.remove('pendingMediaUrl', () => void chrome.runtime.lastError);
          // The live media event is already forwarded immediately; keepAlive only clears stale storage.
        }
      }
    });
  }, 1000);
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
    const mediaUrl = message?.payload?.mediaUrl;
    const pageUrl = message?.payload?.pageUrl;
    const sourcePageUrl = message?.payload?.sourcePageUrl || null;
    const cachedSeriesContext = getCachedSeriesContext(sourcePageUrl || pageUrl);
    const seriesContext = message?.payload?.seriesContext || cachedSeriesContext;
    console.log("[Background] Received WT_MEDIA_FOUND from content-script:", mediaUrl?.substring(0, 100));
    if (mediaUrl) {
      forwardMediaToUi(mediaUrl, pageUrl, seriesContext, sourcePageUrl);
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
