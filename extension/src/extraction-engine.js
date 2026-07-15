export function extractSeriesContextInPage(pageUrlArg, profileArg) {
  if (document.readyState === "loading" || !document.body || document.body.innerText.length < 120) {
    return null;
  }

  const normalizeText = (value) =>
    String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

  const readPath = (value, path) => {
    const parts = String(path || "").split(".").filter(Boolean);
    let current = value;
    for (const part of parts) {
      if (current == null) return null;
      current = current[part];
    }
    return current == null ? null : current;
  };

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

  const queryAllConfigured = (selectors, rootDocument = document) => {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors].filter(Boolean);
    const roots = collectShadowRoots(rootDocument);
    const nodes = [];

    for (const root of roots) {
      for (const selector of selectorList) {
        try {
          nodes.push(...root.querySelectorAll(selector));
        } catch {
          continue;
        }
      }
    }

    return [...new Set(nodes)];
  };

  const getNodeValue = (node, attribute = null) => {
    if (!node) return "";
    if (attribute) return normalizeText(node.getAttribute(attribute) || node[attribute] || "");
    return normalizeText(node.textContent || node.getAttribute?.("content") || "");
  };

  const readJsonLdCandidates = (rootDocument = document) => {
    const candidates = [];
    for (const script of queryAllConfigured('script[type="application/ld+json"]', rootDocument)) {
      const rawJson = String(script.textContent || "").trim();
      if (!rawJson) continue;
      try {
        const parsed = JSON.parse(rawJson);
        candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      } catch {
        continue;
      }
    }
    return candidates;
  };

  const resolveConfiguredField = (fieldName, rootDocument = document) => {
    const fieldSources = profileArg?.fields?.[fieldName];
    if (!Array.isArray(fieldSources)) return null;

    for (const source of fieldSources) {
      const type = typeof source === "string" ? source : source?.type;
      if (type === "jsonLd") {
        const paths = Array.isArray(source.paths) && source.paths.length > 0 ? source.paths : [fieldName];
        for (const candidate of readJsonLdCandidates(rootDocument)) {
          for (const path of paths) {
            const value = normalizeText(readPath(candidate, path));
            if (value) return value;
          }
        }
      } else if (type === "meta" || type === "dom") {
        for (const node of queryAllConfigured(source.selectors, rootDocument)) {
          const value = getNodeValue(node, source.attribute);
          if (value) return value;
        }
      } else if (type === "documentTitle") {
        const rawTitle = normalizeText(rootDocument.title || document.title);
        const patterns = Array.isArray(source.patterns) ? source.patterns : [];
        for (const pattern of patterns) {
          try {
            const match = rawTitle.match(new RegExp(pattern, "i"));
            const value = normalizeText(match?.[1] || "");
            if (value) return value;
          } catch {
            continue;
          }
        }
        if (rawTitle) return rawTitle;
      }
    }

    return null;
  };

  const normalizeUrl = (value) => {
    try {
      const url = new URL(value, document.baseURI);
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  };

  const currentPageUrl = normalizeUrl(pageUrlArg) || document.location.href;
  const title = resolveConfiguredField("title") ||
    document.querySelector('meta[property="og:title"]')?.content?.trim() ||
    document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
    document.title.replace(/\s+/g, " ").trim();
  const isOwnUiTitle = /anytogether|press play together|wherever you are/i.test(title || "");
  if (isOwnUiTitle) {
    return null;
  }

  const samePage = (left, right) => {
    try {
      const leftUrl = new URL(left, document.baseURI);
      const rightUrl = new URL(right, document.baseURI);
      return (
        leftUrl.origin === rightUrl.origin &&
        leftUrl.pathname.replace(/\/+$/, "") === rightUrl.pathname.replace(/\/+$/, "")
      );
    } catch {
      return false;
    }
  };

  const hasEpisodeMarker = (value) =>
    /(?:s\d+\s*e\d+|season\s*\d+|episode\s*\d+|ep\.?\s*\d+|\u0441\u0435\u0440\u0438\u044f\s*\d+|\u0441\u0435\u0437\u043e\u043d\s*\d+)/iu.test(String(value || ""));

  const isBlockedText = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return false;
    return [
      "comment",
      "comments",
      "reply",
      "replies",
      "voice",
      "season episodes",
      "episode discussion",
      "episode discussions",
      "discussion",
      "discussions",
      "trailer"
    ].some((term) => normalized.includes(term));
  };

  const collectDocuments = (rootDocument = document, maxDepth = 2) => {
    const documents = [];
    const visited = new Set();

    const pushDocument = (candidateDocument, depth) => {
      if (!candidateDocument || visited.has(candidateDocument) || depth > maxDepth) return;
      const candidateUrl = String(candidateDocument.location?.href || "");
      if (!/^https?:/i.test(candidateUrl)) return;
      visited.add(candidateDocument);
      documents.push(candidateDocument);

      let frames = [];
      try {
        frames = [...candidateDocument.querySelectorAll("iframe")];
      } catch {
        frames = [];
      }

      for (const frame of frames) {
        try {
          const frameSrc = String(frame.getAttribute?.("src") || frame.src || "");
          if (frameSrc && !/^https?:/i.test(frameSrc)) continue;
          const frameDocument = frame.contentDocument || frame.contentWindow?.document || null;
          if (!frameDocument) continue;
          if (frameDocument.location && candidateDocument.location && frameDocument.location.origin !== candidateDocument.location.origin) {
            continue;
          }
          pushDocument(frameDocument, depth + 1);
        } catch {
          // Cross-origin frames are expected to fail here.
        }
      }
    };

    pushDocument(rootDocument, 0);
    return documents;
  };

  const collectQualityItems = (rootDocument = document) => {
    const qualityNodes = queryAllConfigured(
      "select option, button, [role='button'], [data-quality], [data-quality-label], [data-res], [data-src], [src], [aria-label], [title], li, span, div",
      rootDocument
    );
    const seen = new Set();
    const qualityItems = [];

    for (const node of qualityNodes) {
      const explicitQuality =
        node.getAttribute("data-quality-label") ||
        node.getAttribute("data-quality") ||
        node.getAttribute("data-res") ||
        "";
      const rawLabel =
        explicitQuality ||
        node.getAttribute("data-src") ||
        node.getAttribute("src") ||
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        node.textContent ||
        node.value ||
        "";
      const label = normalizeText(rawLabel);
      if (!label) continue;

      const compact = label.toLowerCase().replace(/\s+/g, "");
      const isCompactQuality = /^(?:\d{3,4}p|\d{3,4}x\d{3,4}|[48]k|auto|uhd|fhd|fd|hd)$/i.test(compact);
      if (!explicitQuality && !isCompactQuality) continue;
      if (label.length > 40 && !explicitQuality) continue;
      if (seen.has(compact)) continue;

      seen.add(compact);
      qualityItems.push({
        label,
        normalizedLabel: compact,
        active: Boolean(node.matches?.("[selected], [aria-selected='true'], [aria-pressed='true'], .active, .is-active"))
      });
    }

    return qualityItems;
  };

  const buildContext = ({ seasonTitles, episodeItems, translatorItems, qualityItems, discoveryStrategy, resolver = null }) => {
    if (!Array.isArray(episodeItems) || episodeItems.length < 2) return null;
    const seasons = [];
    if (Array.isArray(seasonTitles) && seasonTitles.length > 0) {
      for (const [seasonIndex, seasonTitle] of seasonTitles.entries()) {
        const seasonId = seasonIndex + 1;
        seasons.push({
          seasonId,
          title: seasonTitle || `Season ${seasonId}`,
          episodes: episodeItems.map((episode) => ({ ...episode, seasonId }))
        });
      }
    } else {
      seasons.push({
        seasonId: 1,
        title: "Episodes",
        episodes: episodeItems
      });
    }

    const currentEpisodeIndex = episodeItems.findIndex((episode) => episode.url && samePage(episode.url, currentPageUrl));
    const activeEpisodeIndex = currentEpisodeIndex >= 0 ? currentEpisodeIndex : 0;
    const activeEpisode = episodeItems[activeEpisodeIndex] || episodeItems[0];
    return {
      title: title || null,
      currentPageUrl,
      currentSeasonId: activeEpisode?.seasonId ?? seasons[0]?.seasonId ?? 1,
      currentEpisodeId: activeEpisode?.episodeId ?? 1,
      currentEpisodeIndex: activeEpisodeIndex,
      seasons,
      episodes: episodeItems,
      translators: Array.isArray(translatorItems) ? translatorItems : [],
      selectedTranslatorId: translatorItems?.find((item) => item.active)?.translatorId || null,
      selectedTranslatorTitle: translatorItems?.find((item) => item.active)?.title || null,
      availableQualities: Array.isArray(qualityItems) ? qualityItems : [],
      selectedQualityLabel: qualityItems?.find((item) => item.active)?.label || qualityItems?.[0]?.label || null,
      discoveryStrategy,
      resolver
    };
  };

  const collectCustomPicker = (rootDocument = document, sourceConfig = {}) => {
    const pickerSelectors = Array.isArray(sourceConfig.selectors) && sourceConfig.selectors.length > 0
      ? sourceConfig.selectors
      : [
      "hdvbplayer",
      "hdbvplayer",
      "[me]",
      "[fid]",
      "[data-src]",
      "[data-url]",
      "[data-href]",
      "[data-cdn_url]",
      "[class*='player']",
      "[class*='tabs']",
      "[class*='episode']",
      "[class*='season']",
      "[class*='quality']",
      "[class*='voice']",
      "[class*='translator']"
    ];
    const pickerNodes = [...new Set(pickerSelectors.flatMap((selector) => queryAllConfigured(selector, rootDocument)))];
    const groups = [];
    const parseNumericId = (label) => {
      const match = normalizeText(label).match(/(\d+)/);
      return match ? Number(match[1]) : null;
    };
    const isActiveNode = (node) =>
      Boolean(
        node?.matches?.(".active, .is-active, [aria-selected='true'], [selected], [aria-pressed='true']") ||
        /rgb\(0,\s*173,\s*239\)/i.test(node?.getAttribute?.("style") || "")
      );

    for (const container of pickerNodes) {
      if (!container?.children || container.children.length < 2) continue;
      const directChildren = [...container.children].filter((child) => normalizeText(child.textContent));
      if (directChildren.length < 2) continue;

      const listContainer =
        directChildren.find((child) => child.children && child.children.length >= 2) ||
        directChildren[1] ||
        null;
      if (!listContainer) continue;

      const headerText = normalizeText(directChildren[0].textContent);
      const itemNodes = [...listContainer.children].filter((child) => normalizeText(child.textContent));
      if (itemNodes.length < 2) continue;

      const itemLabels = itemNodes.map((node) => normalizeText(node.textContent)).filter(Boolean);
      if (itemLabels.length < 2) continue;
      const combined = `${headerText} ${itemLabels.join(" ")}`.toLowerCase();
      if (isBlockedText(combined)) continue;

      let kind = null;
      if (/(\d{3,4}p|\d{3,4}x\d{3,4}|[48]k|\bauto\b|\buhd\b|\bfhd\b|\bfd\b|\bhd\b)/i.test(combined)) {
        kind = "quality";
      } else if (/\b(season|\u0441\u0435\u0437\u043e\u043d)\b/i.test(combined) || itemLabels.some((label) => /\b(season|\u0441\u0435\u0437\u043e\u043d)\b/i.test(label))) {
        kind = "season";
      } else if (/\b(episode|\u0441\u0435\u0440\u0438\u044f|ep\.?|s\d+\s*e\d+)\b/i.test(combined)) {
        kind = "episode";
      } else if (/\b(voice|translator|\u043e\u0437\u0432\u0443\u0447|\u043f\u0435\u0440\u0435\u0432\u043e\u0434)\b/i.test(combined) || itemLabels.every((label) => !/\d/.test(label))) {
        kind = "translator";
      }
      if (!kind) continue;

      groups.push({
        kind,
        itemLabels,
        itemNodes,
        activeIndex: itemNodes.findIndex((node) => isActiveNode(node))
      });
    }

    const pickGroup = (kind) => {
      const matches = groups.filter((group) => group.kind === kind);
      if (matches.length === 0) return null;
      matches.sort((left, right) => right.itemLabels.length - left.itemLabels.length);
      return matches[0];
    };

    const episodeGroup = pickGroup("episode");
    const seasonGroup = pickGroup("season");
    const translatorGroup = pickGroup("translator");
    const qualityGroup = pickGroup("quality");

    const episodeItems = (episodeGroup?.itemLabels || []).map((label, index) => {
      const episodeId = parseNumericId(label) || index + 1;
      return { title: label, url: null, seasonId: 1, episodeId };
    });
    const seasonTitles = seasonGroup?.itemLabels || [];
    const translatorItems = (translatorGroup?.itemLabels || []).map((label, index) => ({
      translatorId: index + 1,
      title: label,
      active: Boolean(translatorGroup && index === translatorGroup.activeIndex)
    }));
    const qualityItems = (qualityGroup?.itemLabels || []).map((label, index) => ({
      label,
      normalizedLabel: label.toLowerCase().replace(/\s+/g, ""),
      active: Boolean(qualityGroup && index === qualityGroup.activeIndex)
    }));

    return buildContext({
      seasonTitles,
      episodeItems,
      translatorItems,
      qualityItems,
      discoveryStrategy: "custom-picker"
    });
  };

  const collectHdvbMePicker = (rootDocument = document, sourceConfig = {}) => {
    const seasonSelector = sourceConfig.seasonSelector || 'hdvbplayer[me^="x-"]';
    const episodeSelector = sourceConfig.episodeSelector || 'hdvbplayer[me^="xx-"]';
    const translatorSelector = sourceConfig.translatorSelector || 'hdvbplayer[me^="xxx-"]';
    const activeStylePattern = new RegExp(sourceConfig.activeStylePattern || "rgb\\(0,\\s*173,\\s*239\\)", "i");
    const activeSelector = sourceConfig.activeSelector || "[aria-selected='true'], [aria-pressed='true'], .active, .is-active";
    const seasonMePattern = new RegExp(sourceConfig.seasonMePattern || "^x-\\d+-(\\d+)$");
    const episodeMePattern = new RegExp(sourceConfig.episodeMePattern || "^xx-\\d+-(\\d+)-\\d+-\\d+-(\\d+)$");
    const translatorMePattern = new RegExp(sourceConfig.translatorMePattern || "^xxx-\\d+-(\\d+)-\\d+-\\d+-(\\d+)-(\\d+)-");
    const isActiveNode = (node) => {
      if (!node) return false;
      if (activeStylePattern.test(node.getAttribute?.("style") || "")) return true;
      try {
        return Boolean(activeSelector && node.matches?.(activeSelector));
      } catch {
        return false;
      }
    };
    const parseNumber = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const rememberPreferred = (map, key, item) => {
      const existing = map.get(key);
      if (!existing || item.active) {
        map.set(key, item);
      }
    };

    const seasonSeen = new Map();
    for (const node of queryAllConfigured(seasonSelector, rootDocument)) {
      const me = String(node.getAttribute("me") || "");
      const match = me.match(seasonMePattern);
      const seasonId = parseNumber(match?.[1]);
      if (!seasonId) continue;
      rememberPreferred(seasonSeen, seasonId, {
        seasonId,
        title: normalizeText(node.textContent) || `Season ${seasonId}`,
        episodes: [],
        active: isActiveNode(node)
      });
    }

    const episodeSeen = new Map();
    for (const node of queryAllConfigured(episodeSelector, rootDocument)) {
      const me = String(node.getAttribute("me") || "");
      const match = me.match(episodeMePattern);
      const seasonId = parseNumber(match?.[1]);
      const episodeId = parseNumber(match?.[2]);
      if (!seasonId || !episodeId) continue;
      rememberPreferred(episodeSeen, `${seasonId}:${episodeId}`, {
        title: normalizeText(node.textContent) || `Episode ${episodeId}`,
        url: null,
        seasonId,
        episodeId,
        active: isActiveNode(node)
      });
    }

    const resolvedSeasonItems = [...seasonSeen.values()];
    const resolvedEpisodeItems = [...episodeSeen.values()]
      .sort((left, right) => (left.seasonId - right.seasonId) || (left.episodeId - right.episodeId));

    if (resolvedEpisodeItems.length < 2) return null;

    const seasonMap = new Map(resolvedSeasonItems.map((season) => [season.seasonId, { ...season, episodes: [] }]));
    for (const episode of resolvedEpisodeItems) {
      if (!seasonMap.has(episode.seasonId)) {
        seasonMap.set(episode.seasonId, {
          seasonId: episode.seasonId,
          title: `Season ${episode.seasonId}`,
          episodes: [],
          active: false
        });
      }
      seasonMap.get(episode.seasonId).episodes.push(episode);
    }

    const resolvedSeasons = [...seasonMap.values()].sort((left, right) => left.seasonId - right.seasonId);
    const translatorSeen = new Set();
    const translatorItems = queryAllConfigured(translatorSelector, rootDocument)
      .map((node) => {
        const me = String(node.getAttribute("me") || "");
        const match = me.match(translatorMePattern);
        const translatorId = parseNumber(match?.[3]);
        const title = normalizeText(node.textContent);
        const key = `${translatorId || title}:${title}`;
        if ((!translatorId && !title) || translatorSeen.has(key)) return null;
        translatorSeen.add(key);
        return {
          translatorId: translatorId || translatorSeen.size,
          title: title || `Translator ${translatorId || translatorSeen.size}`,
          active: isActiveNode(node)
        };
      })
      .filter(Boolean);

    const activeEpisode = resolvedEpisodeItems.find((episode) => episode.active) ||
      resolvedSeasons.find((season) => season.active)?.episodes?.[0] ||
      resolvedEpisodeItems[0];
    const currentEpisodeIndex = Math.max(0, resolvedEpisodeItems.findIndex(
      (episode) => episode.seasonId === activeEpisode.seasonId && episode.episodeId === activeEpisode.episodeId
    ));

    return {
      title: title || null,
      currentPageUrl,
      currentSeasonId: activeEpisode.seasonId,
      currentEpisodeId: activeEpisode.episodeId,
      currentEpisodeIndex,
      seasons: resolvedSeasons.map((season) => ({
        seasonId: season.seasonId,
        title: season.title,
        episodes: season.episodes
      })),
      episodes: resolvedEpisodeItems,
      translators: translatorItems,
      selectedTranslatorId: translatorItems.find((item) => item.active)?.translatorId || null,
      selectedTranslatorTitle: translatorItems.find((item) => item.active)?.title || null,
      availableQualities: [],
      selectedQualityLabel: null,
      discoveryStrategy: "hdvbMePicker",
      resolver: null
    };
  };

  const collectEmbeddedData = (rootDocument = document) => {
    for (const inspectableDocument of collectDocuments(rootDocument, 2)) {
      const scripts = queryAllConfigured('script[type="application/ld+json"]', inspectableDocument);
      for (const script of scripts) {
        const rawJson = String(script.textContent || "").trim();
        if (!rawJson) continue;
        try {
          const parsed = JSON.parse(rawJson);
          const candidates = Array.isArray(parsed) ? parsed : [parsed];
          for (const candidate of candidates) {
            const itemList = candidate?.itemListElement || candidate?.mainEntity?.itemListElement || candidate?.hasPart || candidate?.episode || candidate?.episodes;
            if (!Array.isArray(itemList) || itemList.length < 2) continue;
            const episodeItems = itemList
              .map((entry, index) => {
                const item = entry?.item || entry;
                const episodeTitle = normalizeText(item?.name || entry?.name || item?.headline || entry?.headline || item?.text || entry?.text || "");
                const episodeUrl = normalizeUrl(item?.url || entry?.url || item?.["@id"] || entry?.["@id"] || "");
                if (!episodeTitle && !episodeUrl) return null;
                const position = Number(entry?.position || item?.position || index + 1);
                return {
                  title: episodeTitle || `Episode ${index + 1}`,
                  url: episodeUrl,
                  seasonId: 1,
                  episodeId: Number.isFinite(position) ? position : index + 1
                };
              })
              .filter(Boolean);
            const built = buildContext({
              seasonTitles: [candidate?.name || "Episodes"],
              episodeItems,
              translatorItems: [],
              qualityItems: collectQualityItems(inspectableDocument),
              discoveryStrategy: "embedded-data"
            });
            if (built) return built;
          }
        } catch {
          // Invalid embedded JSON should not stop the cascade.
        }
      }
    }
    return null;
  };

  const collectGenericLinks = (rootDocument = document, sourceConfig = {}) => {
    const selectors = Array.isArray(sourceConfig.selectors) && sourceConfig.selectors.length > 0
      ? sourceConfig.selectors
      : [
      "a[href]",
      "li a[href]",
      "nav a[href]",
      "article a[href]",
      "section a[href]",
      "main a[href]",
      "[data-episode_id]",
      "[data-episode-id]",
      "[data-season_id]",
      "[data-season-id]",
      "[data-episode-url]",
      "[data-url]",
      "[data-href]",
      "[data-cdn_url]"
    ];
    const nodes = [...new Set(selectors.flatMap((selector) => queryAllConfigured(selector, rootDocument)))];
    const seen = new Set();
    const episodeItems = [];

    for (const node of nodes) {
      const href = normalizeUrl(
        node.getAttribute("href") ||
          node.getAttribute("data-episode-url") ||
          node.getAttribute("data-url") ||
          node.getAttribute("data-href") ||
          node.getAttribute("data-cdn_url")
      );
      const text = normalizeText(node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
      const containerText = normalizeText(node.closest("li, article, section, div")?.innerText || "");
      const combined = `${text} ${containerText} ${href || ""}`.toLowerCase();
      if (!href && !hasEpisodeMarker(combined)) continue;
      if (isBlockedText(combined)) continue;

      const key = href || `${text}|${containerText}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const seasonId = Number(node.getAttribute("data-season_id") || node.getAttribute("data-season-id")) || 1;
      const episodeId = Number(node.getAttribute("data-episode_id") || node.getAttribute("data-episode-id")) || episodeItems.length + 1;
      if (!text && !href) continue;
      episodeItems.push({
        title: text || `Episode ${episodeItems.length + 1}`,
        url: href,
        seasonId,
        episodeId
      });
    }

    return buildContext({
      seasonTitles: [],
      episodeItems: episodeItems.slice(0, 24),
      translatorItems: [],
      qualityItems: collectQualityItems(rootDocument),
      discoveryStrategy: "generic-links"
    });
  };

  const collectGenericAttributes = (rootDocument = document, sourceConfig = {}) => {
    const selectors = Array.isArray(sourceConfig.selectors) && sourceConfig.selectors.length > 0
      ? sourceConfig.selectors
      : [
      "[data-episode_id]",
      "[data-episode-id]",
      "[data-season_id]",
      "[data-season-id]",
      "[data-episode]",
      "[data-season]",
      "[data-episode-url]",
      "[data-url]",
      "[data-href]",
      "[data-cdn_url]"
    ];
    const nodes = [...new Set(selectors.flatMap((selector) => queryAllConfigured(selector, rootDocument)))];
    const episodeItems = [];
    const seen = new Set();

    for (const node of nodes) {
      const text = normalizeText(node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
      const href = normalizeUrl(
        node.getAttribute("data-episode-url") ||
          node.getAttribute("data-url") ||
          node.getAttribute("data-href") ||
          node.getAttribute("data-cdn_url") ||
          node.getAttribute("href")
      );
      const seasonId = Number(node.getAttribute("data-season_id") || node.getAttribute("data-season-id")) || 1;
      const episodeId = Number(node.getAttribute("data-episode_id") || node.getAttribute("data-episode-id")) || episodeItems.length + 1;
      const combined = `${text} ${href || ""}`.toLowerCase();
      if (!href && !hasEpisodeMarker(combined)) continue;
      if (isBlockedText(combined)) continue;
      const key = `${seasonId}:${episodeId}:${href || text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      episodeItems.push({
        title: text || `Episode ${episodeItems.length + 1}`,
        url: href,
        seasonId,
        episodeId
      });
    }

    return buildContext({
      seasonTitles: [],
      episodeItems: episodeItems.slice(0, 24),
      translatorItems: [],
      qualityItems: collectQualityItems(rootDocument),
      discoveryStrategy: "generic-attributes"
    });
  };

  const sources = Array.isArray(profileArg?.seriesContext) && profileArg.seriesContext.length > 0
    ? profileArg.seriesContext
    : Array.isArray(profileArg?.seriesSources) && profileArg.seriesSources.length > 0
      ? profileArg.seriesSources
      : ["custom-picker", "embedded-jsonld", "generic-links", "generic-attributes"];

  for (const source of sources) {
    const sourceType = typeof source === "string" ? source : source?.type;
    let context = null;
    if ((sourceType === "structuredDom" || sourceType === "structured-dom") && profileArg?.id === "rezka") {
      const resolverPattern = source?.resolverPattern || "initCDNSeriesEvents\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),";
      const resolverMatch = document.documentElement.innerHTML.match(new RegExp(resolverPattern, "i"));
      if (resolverMatch) {
        const resolver = {
          provider: source?.provider || "rezka",
          itemId: Number(resolverMatch[1]),
          translatorId: Number(resolverMatch[2]),
          pageUrl: currentPageUrl,
          origin: new URL(currentPageUrl).origin,
          favs: document.querySelector(source?.favoritesSelector || "#ctrl_favs")?.value || "",
          contentType: "series"
        };
        const seasonSelector = source?.seasons?.selector || "#simple-seasons-tabs .b-simple_season__item";
        const seasonIdAttribute = source?.seasons?.idAttribute || "data-tab_id";
        const episodeSelectorTemplate = source?.episodes?.selectorTemplate || "#simple-episodes-list-{seasonId} .b-simple_episode__item";
        const episodeIdAttribute = source?.episodes?.idAttribute || "data-episode_id";
        const translatorSelector = source?.translators?.selector || "#translators-list .b-translator__item";
        const translatorIdAttribute = source?.translators?.idAttribute || "data-translator_id";
        const translatorTitleAttribute = source?.translators?.titleAttribute || "title";
        const seasons = queryAllConfigured(seasonSelector, document).map((node) => ({
          seasonId: Number(node.getAttribute(seasonIdAttribute)) || 1,
          title: normalizeText(node.textContent),
          episodes: []
        }));
        const flatEpisodes = [];
        for (const season of seasons) {
          const episodeSelector = episodeSelectorTemplate.replaceAll("{seasonId}", String(season.seasonId));
          const seasonEpisodes = queryAllConfigured(episodeSelector, document)
            .map((node) => ({
              title: normalizeText(node.textContent),
              seasonId: season.seasonId,
              episodeId: Number(node.getAttribute(episodeIdAttribute)) || flatEpisodes.length + 1
            }));
          season.episodes = seasonEpisodes;
          flatEpisodes.push(...seasonEpisodes);
        }
        if (flatEpisodes.length >= 2) {
          context = buildContext({
            seasonTitles: seasons.map((season) => season.title),
            episodeItems: flatEpisodes,
            translatorItems: queryAllConfigured(translatorSelector, document).map((node, index) => ({
              translatorId: Number(node.getAttribute(translatorIdAttribute)) || index + 1,
              title: normalizeText(node.getAttribute(translatorTitleAttribute) || node.textContent),
              active: Boolean(node.matches?.(".active, .is-active"))
            })),
            qualityItems: collectQualityItems(document),
            discoveryStrategy: "structuredDom",
            resolver
          });
        }
      }
    } else if (sourceType === "hdvbMePicker") {
      context = collectHdvbMePicker(document, source);
    } else if (sourceType === "customPicker" || sourceType === "custom-picker") {
      context = collectCustomPicker(document, source);
    } else if (sourceType === "jsonLd" || sourceType === "embedded-jsonld") {
      context = collectEmbeddedData(document);
    } else if (sourceType === "linkCollection" || sourceType === "generic-links") {
      context = collectGenericLinks(document, source);
    } else if (sourceType === "attributeCollection" || sourceType === "generic-attributes") {
      context = collectGenericAttributes(document, source);
    }

  if (context) {
      console.log("[AnyTogether Parser] Series context strategy:", sourceType, {
        title: context.title || null,
        seasonCount: Array.isArray(context.seasons) ? context.seasons.length : 0,
        episodeCount: Array.isArray(context.episodes) ? context.episodes.length : 0,
        translatorCount: Array.isArray(context.translators) ? context.translators.length : 0,
        qualityCount: Array.isArray(context.availableQualities) ? context.availableQualities.length : 0
      });
      return context;
    }
  }

  return null;
          
}
