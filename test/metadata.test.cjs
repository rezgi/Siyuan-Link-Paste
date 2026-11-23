const { test } = require('node:test');
const assert = require('node:assert/strict');
global.DOMParser = require('linkedom').DOMParser;
const { normalizeURL, safeResource, extractMeta, getYouTubeId, fetchMetadata } = require('../src/metadata.cjs');
const { buildCardHTML } = require('../src/render.cjs');
const ok = body => ({ code: 0, data: { status: 200, body } });

test('accept only one web URL and reject executable or malformed clipboard values', () => {
  assert.equal(normalizeURL(' www.example.com/path?q=a#x '), 'https://www.example.com/path?q=a#x');
  for (const value of ['javascript:alert(1)', 'file:///d:/notes', 'siyuan://blocks/123', 'https://a.com https://b.com', 'some text', '']) assert.equal(normalizeURL(value), null);
  for (const value of ['', undefined, 'data:text/html,x', 'javascript:alert(1)']) assert.equal(safeResource(value, 'https://example.com/'), '');
});

test('DOM parsing handles apostrophes, entities, reordered attributes, and relative media', () => {
  const meta = extractMeta('<html><head><title>Fallback</title><meta content="Amin\'s &amp; friends" property="og:title"><meta property="og:description" content="a &lt;b&gt;"><meta content="../image.png" property="og:image"><link href="./icon.png" rel="icon"></head></html>', 'https://example.com/posts/entry');
  assert.equal(meta.title, "Amin's & friends");
  assert.equal(meta.description, 'a <b>');
  assert.equal(meta.image, 'https://example.com/image.png');
  assert.equal(meta.favicon, 'https://example.com/posts/icon.png');
});

test('card escapes page content and does not interpolate media URLs into CSS', () => {
  const html = buildCardHTML({ title: '<script>alert(1)</script>', description: '" onload="x', image: 'https://example.com/a\');color:red;/*', favicon: 'javascript:alert(1)' }, 'https://example.com/', 'expanded');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  assert.equal(doc.querySelectorAll('script,[onload],[onerror]').length, 0);
  assert.equal(doc.querySelector('details').hasAttribute('open'), true);
  assert.equal(doc.querySelector('a').textContent, '<script>alert(1)</script>');
  assert.ok(!html.includes('background-image'));
  assert.equal(doc.querySelectorAll('img[src^="javascript:"]').length, 0);
  assert.equal(new DOMParser().parseFromString(buildCardHTML({ title: 'Minimal' }, 'https://example.com', 'compact'), 'text/html').querySelector('img'), null);
});

test('YouTube matching checks the real hostname', () => {
  assert.equal(getYouTubeId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(getYouTubeId('https://www.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
  assert.equal(getYouTubeId('https://evil.example/youtube.com/watch?v=abcdefghijk'), null);
});

test('title-only lookup stops once a title is found; no third party by default', async () => {
  const requests = [];
  const meta = await fetchMetadata('https://example.com/', { post: async (_, data) => { requests.push(data); return ok('<title>A title</title>'); } });
  assert.equal(meta.title, 'A title');
  assert.equal(meta.foundTitle, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload, undefined);
});

test('failed metadata and deadlines keep the original URL', async () => {
  const failed = await fetchMetadata('https://example.com/', { post: async () => { throw new Error('offline'); } });
  assert.equal(failed.title, 'https://example.com/');
  const start = Date.now();
  const slow = await fetchMetadata('https://example.com/', { timeoutMs: 35, post: () => new Promise(() => {}) });
  assert.equal(slow.foundTitle, false);
  assert.ok(Date.now() - start < 300);
});

test('redirects remain web URLs, resolve relative locations, and honor success statuses', async () => {
  const urls = [];
  const meta = await fetchMetadata('https://example.com/old', { post: async (_, data) => {
    urls.push(data.url);
    return urls.length === 1 ? { code: 0, data: { status: 302, headers: { Location: ['/new'] } } } : { code: 0, data: { status: 201, body: '<title>New</title>' } };
  } });
  assert.equal(meta.title, 'New');
  assert.deepEqual(urls, ['https://example.com/old', 'https://example.com/new']);
});

test('abort ends a request without starting fallbacks', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = fetchMetadata('https://example.com/', { signal: controller.signal, post: () => { calls++; return new Promise(() => {}); } });
  controller.abort();
  const meta = await pending;
  assert.equal(meta.foundTitle, false);
  assert.equal(calls, 1);
});

test('desktop success supplies Udemy title and thumbnail without touching the blocked proxy', async () => {
  let proxies = 0;
  const meta = await fetchMetadata('https://www.udemy.com/course/unreal-engine-5-one-course-solution-for-niagara-vfx', {
    card: true,
    browserFetch: async (_url, options) => {
      assert.equal(options.credentials, 'omit');
      return { ok: true, status: 200, text: async () => '<title>Unreal Engine 5: One Course Solution For Niagara VFX</title><meta property="og:image" content="https://img-c.udemycdn.com/course/480x270/4915192_86f5_8.jpg">' };
    },
    post: async () => { proxies++; return { code: 0, data: { status: 403 } }; },
  });
  assert.equal(proxies, 0);
  assert.equal(meta.foundTitle, true);
  assert.match(meta.image, /4915192_86f5_8\.jpg$/);
  assert.equal(meta.attempts[0].transport, 'desktop');
});

test('desktop CORS/network failure falls back to kernel fetching', async () => {
  const meta = await fetchMetadata('https://example.com/', {
    browserFetch: async () => { throw new TypeError('Failed to fetch'); },
    post: async () => ok('<title>Kernel fallback</title>'),
  });
  assert.equal(meta.title, 'Kernel fallback');
  assert.deepEqual(meta.attempts.map(attempt => attempt.transport), ['desktop', 'proxy']);
});

test('desktop body stalls cannot exhaust the fallback deadline', async () => {
  const meta = await fetchMetadata('https://example.com/', {
    timeoutMs: 60,
    browserFetch: async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) }),
    post: async () => ok('<title>Fallback after stall</title>'),
  });
  assert.equal(meta.title, 'Fallback after stall');
});

test('challenge titles from a 200 response are rejected', async () => {
  const meta = await fetchMetadata('https://example.com/', {
    browserFetch: async () => ({ ok: true, status: 200, text: async () => '<title>Just a moment...</title>' }),
    post: async () => ({ code: 0, data: { status: 403 } }),
  });
  assert.equal(meta.foundTitle, false);
  assert.equal(meta.title, 'https://example.com/');
});

test('cards parse as native SiYuan HTML blocks using the installed Lute', { skip: !process.env.SIYUAN_LUTE_PATH }, () => {
  require(process.env.SIYUAN_LUTE_PATH);
  const card = buildCardHTML({ title: 'A title', description: 'Text', image: 'https://example.com/img.png' }, 'https://example.com/', 'compact');
  const dom = global.Lute.New().Md2BlockDOM(card);
  assert.match(dom, /data-type="NodeHTMLBlock"/);
  assert.doesNotMatch(dom, /data-type="NodeCodeBlock"/);
  assert.match(dom, /&lt;details/);
});

test('multiline channel descriptions remain exactly one HTML block, with no spilled paragraphs', { skip: !process.env.SIYUAN_LUTE_PATH }, () => {
  require(process.env.SIYUAN_LUTE_PATH);
  const description = 'Welcome to my channel!\n\nUnreal Engine, CGI, Photography, Digital Art.';
  const card = buildCardHTML({ title: 'William Faucher', description, image: 'https://example.com/image.jpg' }, 'https://www.youtube.com/@WilliamFaucher', 'compact');
  assert.ok(!/[\r\n]/.test(card));
  const doc = new DOMParser().parseFromString(global.Lute.New().Md2BlockDOM(card), 'text/html');
  const blocks = Array.from(doc.querySelectorAll('[data-node-id]'));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].getAttribute('data-type'), 'NodeHTMLBlock');
  const stored = blocks[0].querySelector('protyle-html').getAttribute('data-content');
  const decoded = new DOMParser().parseFromString(stored, 'text/html');
  assert.ok(decoded.querySelector('details').textContent.includes(description));
});
