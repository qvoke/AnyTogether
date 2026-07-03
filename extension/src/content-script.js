const PAGE_TO_EXTENSION_EVENT = "WT_SEARCH_REQUEST";
const PAGE_TO_RESOLVE_EVENT = "WT_RESOLVE_PAGE_URL";
const PAGE_TO_EXTENSION_PING_EVENT = "WT_EXTENSION_PING";
const EXTENSION_TO_PAGE_EVENT = "WT_MEDIA_FOUND";
const EXTENSION_TO_PAGE_SERIES_CONTEXT_EVENT = "WT_SERIES_CONTEXT_FOUND";
const EXTENSION_STATUS_EVENT = "WT_EXTENSION_STATUS";
const EXTENSION_ERROR_EVENT = "WT_EXTENSION_ERROR";
const PAGE_EVENT_SEARCH_RESULT_CLICKED = "WT_SEARCH_RESULT_CLICKED";
const SEARCH_POPUP_WINDOW_NAME = "AnyTogetherSearch";

  function sendRuntimeMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch {
      // The extension can disconnect while the page is still dispatching updates.
  }
}

(function() {
  const isIframe = window !== window.top;
  const pageUrl = window.location.href;
  const isSearchPopupWindow = window.name === SEARCH_POPUP_WINDOW_NAME;

  // Run only on the UI page and supported media pages.
  // The content script also runs on localhost so it can bridge UI messages.
  // Supported media pages are handled here; unsupported pages exit early.
  const isLocalUiPage = pageUrl.includes("localhost:3000");
  const isRezkaPage = /rezka/i.test(pageUrl) || /voidboost/i.test(pageUrl);

  if (!isLocalUiPage && !isRezkaPage && !isSearchPopupWindow) {
    return;
  }

  console.log("[AnyTogether CS] Loaded at:", pageUrl, "| isIframe:", isIframe);

  function injectSearchPopupToolbar() {
    if (!isSearchPopupWindow || document.getElementById("anytogether-popup-toolbar")) {
      return;
    }

    const toolbar = document.createElement("div");
    toolbar.id = "anytogether-popup-toolbar";
    toolbar.style.cssText = [
      "position:fixed",
      "top:8px",
      "left:8px",
      "z-index:2147483647",
      "display:flex",
      "gap:4px",
      "padding:4px",
      "border-radius:8px",
      "background:rgba(10,17,34,0.92)",
      "border:1px solid rgba(255,255,255,0.12)",
      "box-shadow:0 8px 18px rgba(0,0,0,0.3)",
      "backdrop-filter:blur(10px)"
    ].join(";");

    const makeButton = (direction, action, title) => {
      const button = document.createElement("button");
      button.type = "button";
      button.title = title;
      button.style.cssText = [
        "width:20px",
        "height:20px",
        "display:grid",
        "place-items:center",
        "padding:0",
        "border:none",
        "background:transparent",
        "color:#fff",
        "font:inherit",
        "cursor:pointer"
      ].join(";");
      button.innerHTML = direction === "back"
        ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6l-6 6 6 6"></path><path d="M20 12H8"></path></svg>'
        : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6l6 6-6 6"></path><path d="M4 12h12"></path></svg>';
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
      return button;
    };

    toolbar.appendChild(makeButton("back", () => window.history.back(), "Go to the previous page"));
    toolbar.appendChild(makeButton("forward", () => window.history.forward(), "Go to the next page"));

    const mount = document.body || document.documentElement;
    if (mount) {
      mount.appendChild(toolbar);
    }
  }

  if (isSearchPopupWindow) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectSearchPopupToolbar, { once: true });
    } else {
      injectSearchPopupToolbar();
    }
  }

  function postToPage(type, payload) {
    window.postMessage({ type, payload }, "*");
    if (isIframe) {
      try { window.top.postMessage({ type, payload }, "*"); }
      catch(e) {
        try { if (window.parent) window.parent.postMessage({ type, payload }, "*"); }
        catch(e2) {}
      }
    }
  }

  function isSeriesContextPayload(seriesContext) {
    if (!seriesContext) return false;
    const seasons = Array.isArray(seriesContext.seasons) ? seriesContext.seasons : [];
    const episodes = Array.isArray(seriesContext.episodes) ? seriesContext.episodes : [];
    return seasons.length > 0 || episodes.length > 0;
  }

  function buildSeriesContextSignature(seriesContext) {
    if (!seriesContext) return "";

    return JSON.stringify({
      title: seriesContext.title || null,
      seasonId: seriesContext.currentSeasonId ?? null,
      episodeId: seriesContext.currentEpisodeId ?? null,
      translatorId: seriesContext.selectedTranslatorId ?? null,
      qualityLabel: seriesContext.selectedQualityLabel || null,
      seasonCount: Array.isArray(seriesContext.seasons) ? seriesContext.seasons.length : 0,
      episodeCount: Array.isArray(seriesContext.episodes) ? seriesContext.episodes.length : 0,
      translatorCount: Array.isArray(seriesContext.translators) ? seriesContext.translators.length : 0
    });
  }

  function buildMediaPayloadSignature(payload) {
    if (!payload) return "";
    return [
      String(payload.mediaUrl || ""),
      String(payload.masterPlaylistUrl || ""),
      buildSeriesContextSignature(isSeriesContextPayload(payload.seriesContext) ? payload.seriesContext : null)
    ].join("::");
  }

  function persistPendingMediaPayload(payload) {
    try {
      chrome.storage.local.set(
        {
          pendingMediaUrl: {
            type: "WT_MEDIA_FOUND",
            timestamp: Date.now(),
            payload
          }
        },
        () => void chrome.runtime.lastError
      );
    } catch (e) {}
  }

  function logSeriesContextSummary(prefix, seriesContext) {
    if (!isSeriesContextPayload(seriesContext)) return;

    const signature = JSON.stringify({
      title: seriesContext.title || null,
      seasons: Array.isArray(seriesContext.seasons) ? seriesContext.seasons.length : 0,
      episodes: Array.isArray(seriesContext.episodes) ? seriesContext.episodes.length : 0,
      translators: Array.isArray(seriesContext.translators) ? seriesContext.translators.length : 0
    });

    if (signature === _lastSeriesContextDebugSignature) return;
    _lastSeriesContextDebugSignature = signature;

    console.log(`[AnyTogether CS] ${prefix}:`, {
      title: seriesContext.title || null,
      seasonCount: Array.isArray(seriesContext.seasons) ? seriesContext.seasons.length : 0,
      episodeCount: Array.isArray(seriesContext.episodes) ? seriesContext.episodes.length : 0,
      translatorCount: Array.isArray(seriesContext.translators) ? seriesContext.translators.length : 0
    });
  }

  function sendSeriesContextToUi(seriesContext, pageUrl) {
    if (!isSeriesContextPayload(seriesContext)) return;

    const signature = buildSeriesContextSignature(seriesContext);
    if (!signature || signature === _lastSeriesContextSignature) return;

    _lastSeriesContextSignature = signature;
    sendRuntimeMessage({
      type: EXTENSION_TO_PAGE_SERIES_CONTEXT_EVENT,
      payload: {
        pageUrl: pageUrl || window.location.href,
        sourcePageUrl: pageUrl || window.location.href,
        seriesContext
      }
    });
  }

  function extractSeriesContextFromDom() {
    // Extract the Rezka series context from the DOM so the UI can rebuild the pickers as soon as the page exposes them.
    try {
      const title =
        document.querySelector('meta[property="og:title"]')?.content?.trim() ||
        document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
        document.title.replace(/\s+/g, " ").trim();
      const html = document.documentElement.innerHTML;
      const resolverMatch = html.match(/initCDNSeriesEvents\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),/i);
      const favs = document.querySelector("#ctrl_favs")?.value || "";
      const currentPageUrl = window.location.href;
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

      const seasonItems = [...document.querySelectorAll("#simple-seasons-tabs .b-simple_season__item, .b-simple_season__item[data-tab_id]")];
      const episodeLists = [...document.querySelectorAll("#simple-episodes-tabs .b-simple_episodes__list, [id^='simple-episodes-list-']")];
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

          const seasonEpisodes = [
            ...document.querySelectorAll(
              `#simple-episodes-list-${seasonId} .b-simple_episode__item, #simple-episodes-tabs .b-simple_episode__item[data-season_id="${seasonId}"]`
            )
          ];
          const seasonEpisodeItems = [];
          for (const episodeItem of seasonEpisodes) {
            const episodeId = Number(episodeItem.getAttribute("data-episode_id"));
            if (!Number.isFinite(episodeId)) continue;
            const episodeTitle = (episodeItem.textContent || "").replace(/\s+/g, " ").trim();
            seasonEpisodeItems.push({ title: episodeTitle, seasonId, episodeId });
            flatEpisodes.push({ title: episodeTitle, seasonId, episodeId });
          }

          seasons.push({ seasonId, title: seasonTitle, episodes: seasonEpisodeItems });
        }

        if (flatEpisodes.length >= 2) {
          const activeEpisode = document.querySelector("#simple-episodes-tabs .b-simple_episode__item.active, .b-simple_episode__item.active[data-episode_id]");
          const activeSeason = document.querySelector("#simple-seasons-tabs .b-simple_season__item.active, .b-simple_season__item.active[data-tab_id]");
          const activeSeasonId = activeSeason ? Number(activeSeason.getAttribute("data-tab_id")) : null;
          const activeEpisodeId = activeEpisode ? Number(activeEpisode.getAttribute("data-episode_id")) : null;
          const currentEpisodeIndex = flatEpisodes.findIndex(
            (ep) => ep.seasonId === activeSeasonId && ep.episodeId === activeEpisodeId
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

      // If this is Rezka but no seasons or episodes exist, return a minimal movie context.
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
          resolver: { ...resolver, contentType: resolver.contentType || "movie" }
        };
      }
    } catch(e) {
      console.log("[AnyTogether CS] extractSeriesContextFromDom error:", e);
    }
    return null;
  }

  function sendMediaUrlToUi(mediaUrl, pUrl, seriesContext) {
    if (!mediaUrl) return;
    _lastMediaUrl = mediaUrl;
    const key = mediaUrl.substring(0, 80);
    const meaningfulSeriesContext = isSeriesContextPayload(seriesContext) ? seriesContext : null;
    logSeriesContextSummary("seriesContext received", meaningfulSeriesContext);
    
    if (_monitoredUrls.has(key)) {
      return;
    }
    _monitoredUrls.add(key);
    
    console.log("[AnyTogether CS] Media URL:", mediaUrl.substring(0, 100));
    
    const data = {
      type: "WT_MEDIA_FOUND",
      timestamp: Date.now(),
        payload: {
          roomId: null,
          mediaUrl: mediaUrl,
          masterPlaylistUrl: null,
          pageUrl: pUrl || mediaUrl,
          sourcePageUrl: pUrl || mediaUrl,
          seriesContext: meaningfulSeriesContext
        }
      };
    
    try { chrome.storage.local.set({ pendingMediaUrl: data }, () => void chrome.runtime.lastError); } catch(e) {}
    sendRuntimeMessage({ type: "WT_MEDIA_FOUND", payload: data.payload });
  }

  function isValidMediaUrl(url) {
    if (!url) return false;
    if (/\.ts(?:\?|$)/i.test(url)) return false;
    if (url.startsWith('blob:')) return false;
    if (/\.m3u8(?:\?|$)/i.test(url)) return true;
    if (/\.mp4(?:\?|$)/i.test(url)) return true;
    if (/voidboost.*manifest\.m3u8/i.test(url)) return true;
    if (/voidboost.*index\.m3u8/i.test(url)) return true;
    return false;
  }

  function extractMinimalContext() {
    // Minimal context: extract only the resolver from initCDNSeriesEvents.
    try {
      const html = document.documentElement.innerHTML;
      const resolverMatch = html.match(/initCDNSeriesEvents\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),/i);
      const favs = document.querySelector("#ctrl_favs")?.value || "";
      const currentPageUrl = window.location.href;
      if (resolverMatch) {
        const resolver = {
          provider: "rezka",
          itemId: Number(resolverMatch[1]),
          translatorId: Number(resolverMatch[2]),
          pageUrl: currentPageUrl,
          origin: new URL(currentPageUrl).origin,
          favs,
          contentType: "series"
        };
        // Find the active translator.
        const selectedTranslator = document.querySelector("#translators-list .b-translator__item.active");
        const selectedTranslatorId = selectedTranslator ? Number(selectedTranslator.getAttribute("data-translator_id")) : resolver.translatorId;
        const selectedTranslatorTitle = (selectedTranslator?.getAttribute("title") || selectedTranslator?.textContent || "").replace(/\s+/g, " ").trim();
        
        const title =
          document.querySelector('meta[property="og:title"]')?.content?.trim() ||
          document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
          document.title.replace(/\s+/g, " ").trim();
        
        return {
          title: title || null,
          currentPageUrl,
          currentSeasonId: null,
          currentEpisodeId: null,
          seasons: [],
          episodes: [],
          translators: [],
          selectedTranslatorId,
          selectedTranslatorTitle: selectedTranslatorTitle || null,
          resolver
        };
      }
    } catch(e) {}
    return null;
  }

  function waitForActiveEpisode(retries = 10) {
    if (retries === 10) {
      console.log("[AnyTogether CS] Rezka scan tick");
    }

    const seriesContext = pageUrl.includes('rezka') ? (extractSeriesContextFromDom() || extractMinimalContext()) : null;
    if (seriesContext) {
      sendSeriesContextToUi(seriesContext, window.location.href);
    }

    const episodeNode =
      document.querySelector('.b-simple_episode__item.active[data-cdn_url]') ||
      document.querySelector('.b-simple_episode__item[data-cdn_url]') ||
      document.querySelector('[data-cdn_url]');

    if (episodeNode) {
      const cdnUrl = episodeNode.getAttribute('data-cdn_url');
      if (cdnUrl && /m3u8|mp4/i.test(cdnUrl)) {
        console.log("[AnyTogether CS] Active episode CDN URL:", cdnUrl.substring(0, 100));
        if (pageUrl.includes('rezka')) {
          if (!seriesContext) {
            console.log("[AnyTogether CS] Minimal context fallback:", "null");
          } else {
            console.log("[AnyTogether CS] seriesContext from waitForActiveEpisode:", `seasons:${seriesContext.seasons?.length} translators:${seriesContext.translators?.length} episodes:${seriesContext.episodes?.length}`);
          }
        }
        sendMediaUrlToUi(cdnUrl, window.location.href, seriesContext);
        return;
      }
    }

    if (retries === 10) {
      console.log("[AnyTogether CS] Active Rezka episode not ready yet");
    }

    // Retry until we find the active episode or run out of retries
    if (retries > 0) {
      setTimeout(() => waitForActiveEpisode(retries - 1), 800);
    } else {
      // Fallback: check the video element.
      const video = document.querySelector('video');
      if (video && video.src && !video.src.startsWith('blob:') && /\.(m3u8|mp4)/i.test(video.src)) {
        const seriesContext = pageUrl.includes('rezka') ? (extractSeriesContextFromDom() || extractMinimalContext()) : null;
        sendMediaUrlToUi(video.src, window.location.href, seriesContext);
      }
    }
  }

  // Block video element URL detection until Rezka's XHR loads the correct CDN.
  let _rezkaCdnLoaded = false;
  let _domReady = false;
  // Save the CDN URL so it can be forwarded after the DOM is ready.
  let _pendingCdnUrl = null;
  let _lastMediaUrl = null;
  let _lastSeriesContextSignature = "";
  let _lastSeriesContextDebugSignature = "";
  let _lastDeliveredMediaSignature = "";
  let _receivedLiveMedia = false;
  
  // Wait for the DOM to become ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { 
      _domReady = true;
      // Forward the deferred URL once the DOM is ready.
      if (_pendingCdnUrl) {
        sendMediaUrlToUi(_pendingCdnUrl, window.location.href);
        _pendingCdnUrl = null;
      }
    });
  } else {
    _domReady = true;
  }

  if (isRezkaPage) {
    const runRezkaScan = () => {
      waitForActiveEpisode();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runRezkaScan, { once: true });
    } else {
      runRezkaScan();
    }

    let rezkaScanTimer = null;
    const rezkaObserver = new MutationObserver(() => {
      if (rezkaScanTimer) clearTimeout(rezkaScanTimer);
      rezkaScanTimer = setTimeout(() => {
        waitForActiveEpisode(2);
      }, 400);
    });

    const rezkaTarget = document.body || document.documentElement;
    if (rezkaTarget) {
      rezkaObserver.observe(rezkaTarget, { childList: true, subtree: true, attributes: true });
    }
  }

  // Non-Rezka pages observe video elements immediately.
  if (!pageUrl.includes('rezka')) {
    document.querySelectorAll('video, video source, source').forEach(el => {
      const url = el.currentSrc || el.src || '';
      if (isValidMediaUrl(url)) sendMediaUrlToUi(url, window.location.href);
    });
    
    const observer = new MutationObserver(() => {
      document.querySelectorAll('video, video source, source').forEach(el => {
        const url = el.currentSrc || el.src || '';
        if (isValidMediaUrl(url)) sendMediaUrlToUi(url, window.location.href);
      });
    });
    
    const target = document.querySelector('body') || document.documentElement;
    if (target) observer.observe(target, { childList: true, subtree: true });
  }

  let _monitoredUrls = new Set();
  
  console.log("[AnyTogether CS] Ready");

  window.addEventListener("message", (event) => {
    const fromParent = event.source === window.parent && event.source !== window;
    if (event.source !== window && !fromParent) return;

  if (event.data?.type === PAGE_TO_EXTENSION_PING_EVENT) {
    postToPage(EXTENSION_STATUS_EVENT, {
      message: "Extension detected",
      probe: true
    });
    return;
  }
    
    // Handle sniffer state toggle from UI page
    if (event.data?.type === "WT_SNIFFER_STATE") {
      sendRuntimeMessage({ type: "WT_SNIFFER_STATE", payload: event.data.payload });
      return;
    }
    
    if (event.data?.type !== PAGE_TO_EXTENSION_EVENT && event.data?.type !== PAGE_TO_RESOLVE_EVENT) return;

    chrome.runtime.sendMessage({ type: event.data.type, payload: event.data.payload }, (response) => {
      if (chrome.runtime.lastError) return;
      if (!response?.ok) return;
      postToPage(EXTENSION_TO_PAGE_EVENT, {
        roomId: event.data.payload.roomId,
        mediaUrl: response.mediaUrl,
        masterPlaylistUrl: response.masterPlaylistUrl || null,
        pageUrl: response.pageUrl,
        seriesContext: response.seriesContext || null
      });
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === EXTENSION_STATUS_EVENT) postToPage(EXTENSION_STATUS_EVENT, message.payload);
    if (message?.type === EXTENSION_ERROR_EVENT) postToPage(EXTENSION_ERROR_EVENT, message.payload);
    if (message?.type === EXTENSION_TO_PAGE_SERIES_CONTEXT_EVENT && message?.payload) {
      postToPage(EXTENSION_TO_PAGE_SERIES_CONTEXT_EVENT, message.payload);
    }
    if (message?.type === "WT_MEDIA_FOUND" && message?.payload) {
      _receivedLiveMedia = true;
      _lastMediaUrl = message.payload.mediaUrl || _lastMediaUrl;
      _lastDeliveredMediaSignature = buildMediaPayloadSignature(message.payload);
      if (pageUrl.includes("localhost:3000")) {
        persistPendingMediaPayload(message.payload);
      }
      postToPage("WT_MEDIA_FOUND", message.payload);
    }
  });

  if (!isIframe && pageUrl.includes('localhost:3000')) {
    setInterval(() => {
      try {
        if (_receivedLiveMedia) {
          return;
        }
        if (Date.now() - performance.timeOrigin < 3500) {
          return;
        }
        chrome.storage.local.get('pendingMediaUrl', (result) => {
          const pending = result?.pendingMediaUrl;
          if (pending && pending.payload && pending.payload.mediaUrl) {
            chrome.storage.local.remove('pendingMediaUrl', () => void chrome.runtime.lastError);
            if (Date.now() - (pending.timestamp || 0) < 60000) {
              const pendingSignature = buildMediaPayloadSignature(pending.payload);
              if (pendingSignature && pendingSignature === _lastDeliveredMediaSignature) {
                return;
              }
              postToPage("WT_MEDIA_FOUND", pending.payload);
            }
          }
        });
      } catch(e) {}
    }, 1500);
  }
})();
