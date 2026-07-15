let parserConfigCache = null;

async function loadParserConfigs() {
  if (parserConfigCache) {
    return parserConfigCache;
  }

  const configUrl = chrome.runtime.getURL("src/parser-configs/index.json");
  const response = await fetch(configUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load parser configs: ${response.status}`);
  }

  const configs = await response.json();
  parserConfigCache = Array.isArray(configs) ? configs : [];
  return parserConfigCache;
}

function patternMatches(value, pattern) {
  if (!pattern) return true;

  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return value.toLowerCase().includes(String(pattern).toLowerCase());
  }
}

function matchesDomain(url, domainPattern) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes(String(domainPattern || "").toLowerCase());
  } catch {
    return String(url || "").toLowerCase().includes(String(domainPattern || "").toLowerCase());
  }
}

export async function getParserConfigs() {
  return loadParserConfigs();
}

export async function getParserConfigForUrl(pageUrl) {
  const configs = await loadParserConfigs();
  const url = String(pageUrl || "");
  const matched = configs
    .filter((config) => {
      const domains = Array.isArray(config.domains) ? config.domains : [];
      const paths = Array.isArray(config.pathPatterns) && config.pathPatterns.length > 0 ? config.pathPatterns : [".*"];
      const domainMatches = domains.length === 0 || domains.some((domain) => matchesDomain(url, domain));
      const pathMatches = paths.some((pattern) => patternMatches(url, pattern));
      return domainMatches && pathMatches;
    })
    .sort((left, right) => (right.priority || 0) - (left.priority || 0));

  return matched[0] || configs.find((config) => config.id === "generic") || configs[0] || null;
}

export const getParserProfileForUrl = getParserConfigForUrl;
