// Adapted from Amin's local Card Link plugin (MIT, Luto Yvan).
const AGENTS = {
  crawler: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  browser: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function normalizeURL(value) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text)) return null;
  try {
    const url = new URL(/^www\./i.test(text) ? `https://${text}` : text);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null;
  } catch { return null; }
}

function safeResource(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { return normalizeURL(new URL(value, base).href) || ''; } catch { return ''; }
}

function fallbackMeta(url) {
  const parsed = new URL(url);
  return { title: url, description: '', image: '', favicon: `${parsed.origin}/favicon.ico`, domain: parsed.hostname };
}

function extractMeta(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const content = (...selectors) => {
    for (const selector of selectors) {
      const value = doc.querySelector(selector)?.getAttribute('content')?.trim();
      if (value) return value;
    }
    return '';
  };
  const title = content('meta[property="og:title"]', 'meta[name="og:title"]', 'meta[name="twitter:title"]', 'meta[property="twitter:title"]') || doc.querySelector('title')?.textContent.trim() || '';
  // Some protection pages return 200; never save their challenge as the title.
  if (/^(?:just a moment\.{0,3}|attention required!?\s*\|\s*cloudflare|access denied)$/i.test(title)) {
    return { title: '', description: '', image: '', favicon: '', domain: new URL(url).hostname };
  }
  const description = content('meta[property="og:description"]', 'meta[name="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]');
  const image = content('meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[name="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]');
  const icon = doc.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')?.getAttribute('href');
  return {
    title, description,
    image: image ? safeResource(image, url) : '',
    favicon: icon ? safeResource(icon, url) : '',
    domain: new URL(url).hostname,
  };
}

function mergeMeta(base, extra) {
  return Object.fromEntries(['title', 'description', 'image', 'favicon', 'domain'].map(key => [key, base?.[key] || extra?.[key] || '']));
}

function getYouTubeId(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return /^[\w-]{11}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
  if (!['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) return null;
  const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})(?:\/|$)/)?.[1];
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// A shared deadline covers all redirects and fallbacks, not one timer per retry.
async function fetchMetadata(url, { post, browserFetch, timeoutMs = 4500, card = false, useOEmbed = false, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  const attempts = [];
  let meta = null;
  // Use Chromium's ordinary network path on desktop. The kernel's Go client
  // can receive a bot challenge even when the same public page works here.
  // Leave time for the kernel fallback when browser fetching fails or stalls.
  if (browserFetch && !signal?.aborted) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const budget = Math.min(2500, Math.max(1, Math.floor(timeoutMs * 0.6)));
    let timer;
    try {
      const response = await Promise.race([
        (async () => {
          const result = await browserFetch(url, { credentials: 'omit', redirect: 'follow', signal: controller.signal });
          // Read the body inside the deadline too, not just response headers.
          const body = result.ok ? await result.text() : '';
          return { ok: result.ok, status: result.status, url: result.url || url, body };
        })(),
        new Promise(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve(null); }, budget);
          controller.signal.addEventListener('abort', () => resolve(null), { once: true });
        }),
      ]);
      attempts.push({ transport: 'desktop', status: response?.status || 0 });
      if (response?.ok) meta = extractMeta(response.body, response.url);
    } catch (error) { attempts.push({ transport: 'desktop', status: 0 }); }
    finally {
      clearTimeout(timer);
      controller.abort();
      signal?.removeEventListener('abort', abort);
    }
  }
  async function request(target, agent = 'crawler', redirectsLeft = 3) {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || signal?.aborted) return null;
    let timer;
    let abort;
    try {
      const response = await Promise.race([
        post('/api/network/forwardProxy', {
          url: target, method: 'GET', timeout: remaining,
          headers: [{ 'User-Agent': AGENTS[agent] }, { Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' }],
        }),
        new Promise(resolve => {
          timer = setTimeout(() => resolve(null), remaining);
          abort = () => resolve(null);
          signal?.addEventListener('abort', abort, { once: true });
        }),
      ]);
      if (signal?.aborted || response?.code !== 0 || !response.data) return null;
      const { status, headers = {}, body } = response.data;
      attempts.push({ transport: 'proxy', status });
      if (status >= 300 && status < 400 && redirectsLeft > 0) {
        const location = Object.entries(headers).find(([key]) => key.toLowerCase() === 'location')?.[1];
        const targetURL = safeResource(Array.isArray(location) ? location[0] : location, target);
        return targetURL ? request(targetURL, agent, redirectsLeft - 1) : null;
      }
      return status >= 200 && status < 300 && typeof body === 'string' ? { body, url: target } : null;
    } catch { return null; }
    finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }
  for (const agent of ['crawler', 'browser']) {
    if (meta?.title && (!card || meta.image || meta.description)) break;
    const response = await request(url, agent);
    if (response) {
      try { meta = mergeMeta(meta, extractMeta(response.body, response.url)); } catch { /* Keep the original URL. */ }
    }
    if (meta?.title && (!card || meta.image || meta.description)) break;
  }
  const videoId = getYouTubeId(url);
  if (useOEmbed && (!meta?.title || (card && !meta?.image))) {
    const response = await request(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    if (response) {
      try {
        const data = JSON.parse(response.body);
        if (!data.error) meta = mergeMeta(meta, {
          title: data.title || '', description: data.author_name ? `by ${data.author_name}` : '',
          image: data.thumbnail_url ? safeResource(data.thumbnail_url, url) : '',
        });
      } catch { /* Optional fallback. */ }
    }
  }
  if (card && videoId) meta = mergeMeta(meta, { image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` });
  const foundTitle = !!meta?.title;
  return { ...mergeMeta(meta, fallbackMeta(url)), foundTitle, attempts };
}

module.exports = { normalizeURL, safeResource, fallbackMeta, extractMeta, mergeMeta, getYouTubeId, fetchMetadata };
