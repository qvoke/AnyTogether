const SEARCH_REQUEST_EVENT = "WT_SEARCH_REQUEST";
const RESOLVE_PAGE_REQUEST_EVENT = "WT_RESOLVE_PAGE_URL";
const EXTENSION_STATUS_EVENT = "WT_EXTENSION_STATUS";
const EXTENSION_ERROR_EVENT = "WT_EXTENSION_ERROR";
const MEDIA_URL_REGEX = /https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/i;

function sendStatus(tabId, message) {
  if (typeof tabId !== "number") return;

  chrome.tabs.sendMessage(tabId, {
    type: EXTENSION_STATUS_EVENT,
    payload: { message }
  });
}

function sendError(tabId, message) {
  if (typeof tabId !== "number") return;

  chrome.tabs.sendMessage(tabId, {
    type: EXTENSION_ERROR_EVENT,
    payload: { message }
  });
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

  const preferred = normalizeQualityLabel(preferredQualityLabel);
  if (preferred) {
    const exactMatch = options.find((option) => option.normalizedLabel === preferred);
    if (exactMatch) return exactMatch;

    const looseMatch = options.find((option) => option.normalizedLabel.includes(preferred));
    if (looseMatch) return looseMatch;
  }

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

  const data = await response.json().catch(() => null);
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
    chrome.tabs.remove(searchTab.id).catch(() => {});
  }
}

function waitForMediaUrl(tabId, timeoutMs = 15000) {
  let stop = () => {};

  const promise = new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      chrome.webRequest.onBeforeRequest.removeListener(listener);
      resolve(null);
    }, timeoutMs);

    function listener(details) {
      const candidate = details.url || "";
      if (!MEDIA_URL_REGEX.test(candidate)) return;

      clearTimeout(timeoutId);
      chrome.webRequest.onBeforeRequest.removeListener(listener);
      resolve(candidate);
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
      func: () => {
        const urls = new Set();
        const add = (value) => {
          if (!value || typeof value !== "string") return;
          if (/(?:blob:|data:)/i.test(value)) return;
          if (/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/i.test(value)) {
            urls.add(value);
          }
        };

        document.querySelectorAll("video, video source, source, meta").forEach((node) => {
          if (node.tagName === "VIDEO") {
            add(node.currentSrc);
            add(node.src);
          }

          if (node.tagName === "SOURCE") {
            add(node.src);
          }

          if (node.tagName === "META") {
            add(node.content);
          }
        });

        for (const script of document.scripts) {
          const text = script.textContent || "";
          const matches = text.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi);
          if (matches) {
            matches.forEach(add);
          }
        }

        const htmlMatches = document.documentElement.innerHTML.match(
          /https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi
        );
        if (htmlMatches) {
          htmlMatches.forEach(add);
        }

        return [...urls][0] || null;
      }
    });

    return result?.result || null;
  } catch {
    return null;
  }
}

async function extractSeriesContextFromPage(tabId, pageUrl) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [pageUrl],
      func: (pageUrlArg) => {
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
        const resolverMatch = document.documentElement.innerHTML.match(
          /initCDNSeriesEvents\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),/i
        );
        const favs = document.querySelector("#ctrl_favs")?.value || "";
        const resolver = resolverMatch
          ? {
              provider: "rezka",
              itemId: Number(resolverMatch[1]),
              translatorId: Number(resolverMatch[2]),
              pageUrl: currentPageUrl,
              origin: new URL(currentPageUrl).origin,
              favs
            }
          : null;

        const seasonItems = [...document.querySelectorAll("#simple-seasons-tabs .b-simple_season__item")];
        const episodeLists = [...document.querySelectorAll("#simple-episodes-tabs .b-simple_episodes__list")];
        const translatorItems = [...document.querySelectorAll("#translators-list .b-translator__item")];
        const selectedTranslator = document.querySelector("#translators-list .b-translator__item.active");
        const selectedTranslatorId = selectedTranslator ? Number(selectedTranslator.getAttribute("data-translator_id")) : null;
        const selectedTranslatorTitle = (selectedTranslator?.getAttribute("title") || selectedTranslator?.textContent || "").replace(/\s+/g, " ").trim();

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

          if (flatEpisodes.length >= 2) {
            const activeEpisode = document.querySelector("#simple-episodes-tabs .b-simple_episode__item.active");
            const activeSeason = document.querySelector("#simple-seasons-tabs .b-simple_season__item.active");
            const activeSeasonId = activeSeason ? Number(activeSeason.getAttribute("data-tab_id")) : null;
            const activeEpisodeId = activeEpisode ? Number(activeEpisode.getAttribute("data-episode_id")) : null;
            const currentEpisodeIndex = flatEpisodes.findIndex(
              (episode) => episode.seasonId === activeSeasonId && episode.episodeId === activeEpisodeId
            );

            return {
              title: title || null,
              currentPageUrl,
              currentSeasonId: activeSeasonId,
              currentEpisodeId: activeEpisodeId,
              currentEpisodeIndex,
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

        if (episodeItems.length < 2) return null;

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

    return result?.result || null;
  } catch {
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

async function resolvePageToMedia(pageUrl, hostTabId, statusPrefix, targetEpisode = null) {
  if (targetEpisode?.seriesContext?.resolver?.provider === "rezka") {
    sendStatus(hostTabId, `Opening page: ${pageUrl}`);
    sendStatus(hostTabId, "Resolving episode directly");
    const directResolved = await fetchRezkaEpisodeMedia(targetEpisode.seriesContext, targetEpisode, {
      translatorId: targetEpisode.selectedTranslatorId,
      qualityLabel: targetEpisode.selectedQualityLabel
    });

    if (directResolved?.mediaUrl) {
      sendStatus(hostTabId, "Media URL captured from direct episode resolve");
      return directResolved;
    }

    sendStatus(hostTabId, "Direct episode resolve failed, falling back to page navigation");
  }

  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  const tabId = tab.id;
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

    if (targetEpisode) {
      sendStatus(hostTabId, `Selecting episode: S${targetEpisode.seasonId} E${targetEpisode.episodeId}`);
      const activated = await activateTargetEpisodeOnPage(tabId, targetEpisode);
      if (!activated) {
        sendError(hostTabId, "Episode selection failed");
        return null;
      }

      await delay(2000);
    }

    sendStatus(hostTabId, "Reading page content for media URLs");

    const seriesContext = await extractSeriesContextFromPage(tabId, currentPageUrl);
    let mediaUrl = null;

    if (targetEpisode) {
      sendStatus(hostTabId, "Sniffing media requests");
      mediaUrl = await mediaCapture.promise;

      if (!mediaUrl) {
        sendStatus(hostTabId, "Falling back to page media extraction");
        mediaUrl = await extractMediaUrlFromPage(tabId);
      }
    } else {
      const directMediaUrl = await extractMediaUrlFromPage(tabId);
      if (directMediaUrl) {
        sendStatus(hostTabId, "Media URL captured from page");
        return {
          mediaUrl: directMediaUrl,
          pageUrl: currentPageUrl,
          seriesContext
        };
      }

      sendStatus(hostTabId, "Sniffing media requests");
      mediaUrl = await mediaCapture.promise;
    }

    if (!mediaUrl) {
      return null;
    }

    sendStatus(hostTabId, targetEpisode ? "Media URL captured after episode switch" : "Media URL captured from network");
    return {
      mediaUrl,
      pageUrl: currentPageUrl,
      seriesContext
    };
  } finally {
    mediaCapture.stop();
    chrome.tabs.remove(tabId).catch(() => {});
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

        const resolved = await resolvePageToMedia(pageUrl, hostTabId, "Opening page", {
          ...(message.payload.targetEpisode || {}),
          seriesContext: message.payload.seriesContext || null,
          selectedTranslatorId: message.payload.selectedTranslatorId ?? null,
          selectedQualityLabel: message.payload.selectedQualityLabel ?? null
        });
        if (!resolved?.mediaUrl) {
          sendError(hostTabId, "No media URL captured");
          sendResponse({ ok: false, error: "No media URL captured" });
          return;
        }

        sendResponse({
          ok: true,
          mediaUrl: resolved.mediaUrl,
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

        const resolved = await resolvePageToMedia(resultUrl, hostTabId, "Opening page", null);
        if (resolved?.mediaUrl) {
          sendResponse({
            ok: true,
            mediaUrl: resolved.mediaUrl,
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


