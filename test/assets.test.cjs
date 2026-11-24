const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAssetFolder, localAssetPath, cardImageSource, imageType, saveThumbnail, MAX_IMAGE_BYTES } = require('../src/assets.cjs');
const { normalizeConfig } = require('../src/config.cjs');
const { buildCardHTML } = require('../src/render.cjs');
const { cardMarkdown } = require('../src/cards.cjs');
const { DOMParser } = require('linkedom');
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const url = 'https://example.com/image.png';

function storage() {
  const uploads = [], requests = [];
  return { uploads, requests, post: async (endpoint, data) => {
    requests.push([endpoint, data]);
    if (endpoint === '/api/network/forwardProxy') return { code: 0, data: { status: 200, bodyEncoding: 'base64', body: Buffer.from(png).toString('base64') } };
    if (endpoint === '/api/asset/upload') {
      const file = data.get('file[]'), folder = data.get('assetsDirPath');
      uploads.push({ file, folder, bytes: new Uint8Array(await file.arrayBuffer()) });
      return { code: 0, data: { succMap: { [file.name]: `${folder}/${file.name}` } } };
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  } };
}

test('thumbnail folder defaults to SiYuan assets, supports nested folders and rejects escaping paths', () => {
  for (const input of [undefined, '', '_link_thumbs', 'assets/_link_thumbs', 'assets\\_link_thumbs\\']) assert.equal(normalizeAssetFolder(input), 'assets/_link_thumbs');
  assert.equal(normalizeAssetFolder('media/link cards'), 'assets/media/link cards');
  assert.equal(normalizeAssetFolder('assets'), 'assets');
  for (const input of ['../elsewhere', 'assets/../elsewhere', '/tmp/thumbs', 'C:\\thumbs', '\\\\server\\share', 'assets//bad', 'assets/%2e%2e', 'assets/a?b', 'assets/CON', 'assets/a.']) assert.throws(() => normalizeAssetFolder(input));
});

test('settings preserve native defaults and keep local saving optional when upgrading old configurations', () => {
  const config = normalizeConfig({ timeoutMs: 999999, cardMode: 'expanded', replaceTitle: false });
  assert.equal(config.cardFormat, 'native'); assert.equal(config.saveThumbnails, false);
  assert.equal(config.thumbnailFolder, 'assets/_link_thumbs'); assert.equal(config.timeoutMs, 15000);
  assert.equal(config.replaceTitle, false);
  assert.equal(normalizeConfig({ cardFormat: 'html', saveThumbnails: true }).cardFormat, 'html');
  assert.equal(normalizeConfig({ thumbnailFolder: '../outside' }).thumbnailFolder, 'assets/_link_thumbs');
  assert.throws(() => normalizeConfig({ thumbnailFolder: '../outside' }, true));
});

test('both card renderers keep local asset references and reject invalid asset traversal', () => {
  const image = 'assets/_link_thumbs/image-20261124000000-abcdefg.png';
  assert.equal(localAssetPath(image), image);
  assert.equal(cardImageSource('assets/../file.png', url), '');
  const html = buildCardHTML({ title: 'Title', image }, url, 'compact');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  assert.ok(Array.from(doc.querySelectorAll('img')).every(img => img.getAttribute('src') === `/${image}`));
  assert.equal(new URL(doc.querySelector('img').getAttribute('src'), 'http://127.0.0.1:6806/stage/build/desktop/').pathname, `/${image}`);
  assert.equal(cardImageSource(`/${image}`, url), image);
  assert.ok(cardMarkdown({ title: 'Title', image }, url, 'expanded').includes(`![Preview](<${image}>)`));
});

test('thumbnail download uploads binary data to the default folder using the asset API', async () => {
  const s = storage();
  const result = await saveThumbnail(url, { post: s.post, browserFetch: async () => new Response(png) });
  assert.equal(result.saved, true); assert.ok(result.path.startsWith('assets/_link_thumbs/'));
  assert.equal(s.uploads.length, 1); assert.equal(s.uploads[0].file.type, 'image/png');
  assert.deepEqual(s.uploads[0].bytes, png);
  assert.equal(s.requests.filter(([endpoint]) => endpoint === '/api/network/forwardProxy').length, 0);
});

test('kernel base64 fallback preserves the image bytes when desktop fetch is blocked', async () => {
  const s = storage();
  const result = await saveThumbnail(url, { post: s.post, folder: 'media/custom', browserFetch: async () => { throw new TypeError('CORS'); } });
  assert.equal(result.saved, true); assert.ok(result.path.startsWith('assets/media/custom/'));
  assert.equal(s.requests[0][1].responseEncoding, 'base64');
  assert.deepEqual(s.uploads[0].bytes, png);
});

test('same image and folder reuse a stable name; another folder gets a distinct name', async () => {
  const s = storage();
  for (const folder of ['assets/one', 'assets/one', 'assets/two']) await saveThumbnail(url, { post: s.post, folder });
  assert.equal(s.uploads[0].file.name, s.uploads[1].file.name);
  assert.notEqual(s.uploads[0].file.name, s.uploads[2].file.name);
});

test('failed, HTML and oversized downloads never upload and keep the original image URL', async () => {
  for (const data of [
    { status: 403, body: '', bodyEncoding: 'base64' },
    { status: 200, body: Buffer.from('<html>Challenge</html>').toString('base64'), bodyEncoding: 'base64' },
    { status: 200, body: 'plain text', bodyEncoding: 'text' },
  ]) {
    let uploads = 0;
    const result = await saveThumbnail(url, { post: async endpoint => { if (endpoint === '/api/asset/upload') uploads++; return { code: 0, data }; }, browserFetch: async () => new Response(png, { headers: { 'Content-Length': String(MAX_IMAGE_BYTES + 1) } }) });
    assert.equal(result.saved, false); assert.equal(result.path, url); assert.equal(uploads, 0);
  }
  assert.throws(() => imageType(new TextEncoder().encode('<svg></svg>')));
});

test('invalid destinations, failed uploads and existing local paths are handled without losing the online image', async () => {
  let calls = 0;
  const bad = await saveThumbnail(url, { folder: '../outside', post: async () => { calls++; } });
  assert.equal(bad.saved, false); assert.equal(calls, 0);
  const failed = await saveThumbnail(url, { browserFetch: async () => new Response(png), post: async () => ({ code: -1 }) });
  assert.equal(failed.saved, false); assert.equal(failed.path, url);
  const local = await saveThumbnail('assets/_link_thumbs/existing.png', { post: async () => { calls++; } });
  assert.equal(local.saved, true); assert.equal(calls, 0);
});

test('thumbnail deadlines and cancellation prevent late fallback uploads', async () => {
  const s = storage();
  const controller = new AbortController(); controller.abort();
  const aborted = await saveThumbnail(url, { post: s.post, signal: controller.signal });
  assert.equal(aborted.saved, false); assert.equal(s.requests.length, 0);
  const stalled = await saveThumbnail(url, { timeoutMs: 30, browserFetch: () => new Promise(() => {}), post: () => new Promise(() => {}) });
  assert.equal(stalled.saved, false); assert.match(stalled.error, /timed out/);
});
