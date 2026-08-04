const streamPattern = /\.(?:m3u8|mp4)(?:[?#]|$)/i;

const searchProviders = [
  {
    name: "duckduckgo",
    buildSearchUrl(query) {
      return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    }
  },
  {
    name: "yandex",
    buildSearchUrl(query) {
      return `https://yandex.com/search/?text=${encodeURIComponent(query)}`;
    }
  }
];

const searchAliases = [
  { pattern: /\bvimeo\b/i, site: "vimeo.com" },
  { pattern: /\barchive[- ]?org\b/i, site: "archive.org" },
  { pattern: /\byoutube\b/i, site: "youtube.com" },
  { pattern: /\btwitch\b/i, site: "twitch.tv" },
  { pattern: /\bdailymotion\b/i, site: "dailymotion.com" }
];

const sessionsByRequestId = new Map();
const sessionsByTabId = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "anytogether-bridge") {
    return;
  }

  port.onMessage.addListener((message) => {
    void handleBridgeMessage(port, message);
  });

  port.onDisconnect.addListener(() => {
    void cancelPortSessions(port);
  });
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (
      !streamPattern.test(details.url) ||
      typeof details.tabId !== "number" ||
      details.tabId < 0 ||
      details.statusCode < 200 ||
      details.statusCode >= 300
    ) {
      return;
    }

    const session = sessionsByTabId.get(details.tabId);
    if (!session || session.done || session.targetTabId !== details.tabId) {
      return;
    }

    resolveTargetSession(session, details.url);
  },
  { urls: ["<all_urls>"] }
);

async function handleBridgeMessage(port, message) {
  if (!message || message.type !== "anytogether-plugin:search-request") {
    return;
  }

  const requestId = typeof message.requestId === "string" && message.requestId ? message.requestId : crypto.randomUUID();
  const rawQuery = typeof message.query === "string" ? message.query : "";
  const query = buildSearchQuery(rawQuery);

  if (!query) {
    sendToPort(port, {
      type: "anytogether-plugin:search-error",
      requestId,
      error: "Search query is empty."
    });
    return;
  }

  await cancelPortSessions(port);

  const session = {
    done: false,
    port,
    requestId,
    query,
    searchTabId: null,
    targetTabId: null,
    timeoutId: null,
    resolveTarget: null,
    rejectTarget: null
  };

  sessionsByRequestId.set(requestId, session);

  try {
    const result = await runSearchPipeline(session);
    await completeSession(session, result);
  } catch (error) {
    await failSession(session, error);
  }
}

function buildSearchQuery(rawQuery) {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (!query) {
    return "";
  }

  if (/\bsite:[^\s]+/i.test(query)) {
    return query;
  }

  const alias = searchAliases.find((item) => item.pattern.test(query));
  if (!alias) {
    return query;
  }

  const stripped = query.replace(alias.pattern, "").trim();
  return stripped ? `site:${alias.site} ${stripped}` : `site:${alias.site}`;
}

async function runSearchPipeline(session) {
  let lastError = null;

  for (const provider of searchProviders) {
    try {
      const result = await searchWithProvider(session, provider);
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No stream URL was found.");
}

async function searchWithProvider(session, provider) {
  const tabId = await openBackgroundTab(provider.buildSearchUrl(session.query));
  session.searchTabId = tabId;
  sessionsByTabId.set(tabId, session);

  try {
    await waitForTabComplete(tabId, 15000);
    const candidates = await extractSearchResultCandidates(tabId, provider.name);
    if (!candidates.length) {
      throw new Error(`No organic result was found on ${provider.name}.`);
    }

    for (const candidate of candidates) {
      const playable = await resolvePlayableCandidate(session, candidate);
      if (playable) {
        return playable;
      }
    }

    throw new Error(`No playable media URL was found on ${provider.name}.`);
  } finally {
    await closeSearchTab(session);
  }
}

async function resolvePlayableCandidate(session, candidate) {
  if (!candidate || !candidate.url) {
    return null;
  }

  if (streamPattern.test(candidate.url)) {
    if (await isPlayableMediaUrl(candidate.url)) {
      return {
        mediaUrl: candidate.url,
        originUrl: candidate.url,
        title: candidate.title || candidate.url
      };
    }

    return null;
  }

  const mediaUrl = await sniffTargetPage(session, candidate.url);
  if (!mediaUrl) {
    return null;
  }

  if (!(await isPlayableMediaUrl(mediaUrl))) {
    return null;
  }

  return {
    mediaUrl,
    originUrl: candidate.url,
    title: candidate.title || candidate.url
  };
}

async function sniffTargetPage(session, targetUrl) {
  const tabId = await openBackgroundTab(targetUrl);
  session.targetTabId = tabId;
  sessionsByTabId.set(tabId, session);

  try {
    await waitForTabComplete(tabId, 15000);

    const pageCandidates = await extractPageMediaCandidates(tabId);
    for (const candidateUrl of pageCandidates) {
      if (await isPlayableMediaUrl(candidateUrl)) {
        return candidateUrl;
      }
    }

    return await new Promise((resolve, reject) => {
      let settled = false;
      let handleRemoved = null;

      const finish = (handler) => (value) => {
        if (settled) {
          return;
        }

        settled = true;

        if (session.timeoutId) {
          clearTimeout(session.timeoutId);
          session.timeoutId = null;
        }

        if (handleRemoved) {
          chrome.tabs.onRemoved.removeListener(handleRemoved);
        }

        session.resolveTarget = null;
        session.rejectTarget = null;
        handler(value);
      };

      const resolveOnce = finish(resolve);
      const rejectOnce = finish(reject);
      handleRemoved = (removedTabId) => {
        if (removedTabId === tabId) {
          rejectOnce(new Error("The target tab was closed before a stream URL was found."));
        }
      };

      session.resolveTarget = resolveOnce;
      session.rejectTarget = rejectOnce;

      chrome.tabs.onRemoved.addListener(handleRemoved);
      session.timeoutId = setTimeout(() => {
        rejectOnce(new Error("No stream URL was detected on the opened page."));
      }, 20000);
    });
  } finally {
    await closeTargetTab(session);
  }
}

async function extractSearchResultCandidates(tabId, providerName) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [providerName],
    func: (currentProvider) => {
      const selectors = currentProvider === "yandex"
        ? [
            "a.Link[href]",
            "li.serp-item a[href]",
            "div.Organic a[href]"
          ]
        : [
            "a.result__a[href]",
            "a[href*='uddg=']",
            "article a[href]"
          ];

      const redirectKeys = ["uddg", "url", "u", "redir", "target", "destination"];

      const decodeCandidate = (rawHref) => {
        try {
          const parsed = new URL(rawHref, location.href);
          for (const key of redirectKeys) {
            const value = parsed.searchParams.get(key);
            if (value) {
              return new URL(decodeURIComponent(value), location.href).href;
            }
          }

          return parsed.href;
        } catch {
          return rawHref;
        }
      };

      const isSearchHost = (candidateUrl) => {
        try {
          return new URL(candidateUrl, location.href).hostname === location.hostname;
        } catch {
          return true;
        }
      };

      const readCandidate = (anchor) => {
        const rawHref = anchor.getAttribute("href") || anchor.href;
        if (!rawHref) {
          return null;
        }

        const url = decodeCandidate(rawHref);
        if (!/^https?:/i.test(url) || isSearchHost(url)) {
          return null;
        }

        const title = (anchor.textContent || "").trim() || document.title;
        if (!title) {
          return null;
        }

        return {
          url,
          title
        };
      };

      const pushCandidate = (anchor, list, seen, limit) => {
        if (list.length >= limit) {
          return;
        }

        const candidate = readCandidate(anchor);
        if (!candidate || seen.has(candidate.url)) {
          return;
        }

        seen.add(candidate.url);
        list.push(candidate);
      };

      const seen = new Set();
      const candidates = [];
      const limit = 5;

      for (const selector of selectors) {
        const anchors = Array.from(document.querySelectorAll(selector));
        for (const anchor of anchors) {
          pushCandidate(anchor, candidates, seen, limit);
        }

        if (candidates.length >= limit) {
          return candidates;
        }
      }

      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const anchor of anchors) {
        pushCandidate(anchor, candidates, seen, limit);
        if (candidates.length >= limit) {
          return candidates;
        }
      }

      return candidates;
    }
  });

  return Array.isArray(results[0]?.result) ? results[0].result : [];
}

async function extractPageMediaCandidates(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const sourceParts = [];

      for (const script of document.scripts) {
        if (script.textContent) {
          sourceParts.push(script.textContent);
        }
      }

      if (document.documentElement?.innerHTML) {
        sourceParts.push(document.documentElement.innerHTML);
      }

      const rawPatterns = [
        /https?:\\\/\\\/[^\s"'<>]+?(?:m3u8|mp4)(?:[^\s"'<>]*)/gi,
        /https?:\/\/[^\s"'<>]+?(?:m3u8|mp4)(?:[^\s"'<>]*)/gi
      ];

      const seen = new Set();
      const candidates = [];

      const pushCandidate = (rawValue) => {
        const normalized = rawValue.replace(/\\\//g, "/").replace(/&amp;/g, "&").trim();
        if (!/^https?:\/\//i.test(normalized) || seen.has(normalized)) {
          return;
        }

        try {
          const url = new URL(normalized);
          if (!["http:", "https:"].includes(url.protocol)) {
            return;
          }

          if (!/\.m3u8(?:[?#]|$)/i.test(url.href) && !/\.(?:mp4|m4v)(?:[?#]|$)/i.test(url.href)) {
            return;
          }

          seen.add(url.href);
          candidates.push(url.href);
        } catch {
          // Ignore malformed candidates.
        }
      };

      for (const source of sourceParts) {
        for (const pattern of rawPatterns) {
          pattern.lastIndex = 0;
          for (const match of source.matchAll(pattern)) {
            pushCandidate(match[0]);
            if (candidates.length >= 8) {
              return candidates;
            }
          }
        }
      }

      return candidates;
    }
  });

  return Array.isArray(results[0]?.result) ? results[0].result : [];
}

async function waitForTabComplete(tabId, timeoutMs) {
  return await new Promise((resolve, reject) => {
    let settled = false;

    const finish = (handler) => (value) => {
      if (settled) {
        return;
      }

      settled = true;
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      clearTimeout(timerId);
      handler(value);
    };

    const resolveOnce = finish(resolve);
    const rejectOnce = finish(reject);

    const handleUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        resolveOnce(tab);
      }
    };

    const handleRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        rejectOnce(new Error("The search tab was closed before it finished loading."));
      }
    };

    const timerId = setTimeout(() => {
      rejectOnce(new Error("The search tab timed out while loading."));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        resolveOnce(tab);
      }
    }).catch(() => {
      rejectOnce(new Error("The search tab was closed before it finished loading."));
    });
  });
}

async function isPlayableMediaUrl(url) {
  const normalizedUrl = typeof url === "string" ? url.trim() : "";
  if (!normalizedUrl) {
    return false;
  }

  const isManifest = /\.m3u8(?:[?#]|$)/i.test(normalizedUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(normalizedUrl, {
      method: isManifest ? "GET" : "HEAD",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });

    if (!response.ok) {
      return false;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();

    if (isManifest) {
      if (contentType.includes("text/html")) {
        return false;
      }

      const body = (await response.text()).trimStart();
      return contentType.includes("mpegurl") || body.startsWith("#EXTM3U");
    }

    if (/\.(?:mp4|m4v)(?:[?#]|$)/i.test(normalizedUrl)) {
      return !contentType.includes("text/html");
    }

    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function openBackgroundTab(url) {
  const tab = await chrome.tabs.create({
    url,
    active: false
  });

  if (!tab || typeof tab.id !== "number") {
    throw new Error("Unable to open a background tab.");
  }

  return tab.id;
}

async function closeSearchTab(session) {
  if (session.searchTabId === null) {
    return;
  }

  const tabId = session.searchTabId;
  sessionsByTabId.delete(tabId);
  session.searchTabId = null;
  await closeTab(tabId);
}

async function closeTargetTab(session) {
  if (session.targetTabId === null) {
    return;
  }

  const tabId = session.targetTabId;
  sessionsByTabId.delete(tabId);
  session.targetTabId = null;
  await closeTab(tabId);
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The tab may already be gone by the time cleanup runs.
  }
}

function resolveTargetSession(session, mediaUrl) {
  if (session.done || typeof session.resolveTarget !== "function") {
    return;
  }

  const resolver = session.resolveTarget;
  session.resolveTarget = null;
  session.rejectTarget = null;
  resolver(mediaUrl);
}

function sendToPort(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // The bridge page can disconnect while a request is still being finalized.
  }
}

async function completeSession(session, result) {
  if (session.done) {
    return;
  }

  session.done = true;
  sessionsByRequestId.delete(session.requestId);

  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }

  sendToPort(session.port, {
    type: "anytogether-plugin:search-result",
    requestId: session.requestId,
    title: result.title,
    originUrl: result.originUrl,
    mediaUrl: result.mediaUrl
  });

  await closeSearchTab(session);
  await closeTargetTab(session);
}

async function failSession(session, error) {
  if (session.done) {
    return;
  }

  session.done = true;
  sessionsByRequestId.delete(session.requestId);

  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }

  const message = error instanceof Error ? error.message : String(error || "Unknown search failure.");
  sendToPort(session.port, {
    type: "anytogether-plugin:search-error",
    requestId: session.requestId,
    error: message
  });

  if (session.resolveTarget) {
    const rejectTarget = session.rejectTarget;
    session.resolveTarget = null;
    session.rejectTarget = null;
    if (typeof rejectTarget === "function") {
      rejectTarget(new Error(message));
    }
  }

  await closeSearchTab(session);
  await closeTargetTab(session);
}

async function cancelPortSessions(port) {
  const pendingSessions = Array.from(sessionsByRequestId.values()).filter((session) => session.port === port);

  for (const session of pendingSessions) {
    session.done = true;
    sessionsByRequestId.delete(session.requestId);

    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = null;
    }

    session.resolveTarget = null;
    session.rejectTarget = null;
    await closeSearchTab(session);
    await closeTargetTab(session);
  }
}
