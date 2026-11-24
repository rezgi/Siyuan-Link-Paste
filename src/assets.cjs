const { normalizeURL, safeResource } = require('./metadata.cjs');

const DEFAULT_THUMBNAIL_FOLDER = 'assets/_link_thumbs';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function normalizeAssetFolder(value = DEFAULT_THUMBNAIL_FOLDER) {
  let path = String(value || DEFAULT_THUMBNAIL_FOLDER).trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (path.startsWith('/') || /[:%?#<>"|*\x00-\x1f]/.test(path)) throw new Error('Choose a folder inside SiYuan assets, for example assets/_link_thumbs.');
  if (path !== 'assets' && !path.startsWith('assets/')) path = `assets/${path}`;
  if (path.length > 220 || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('The thumbnail folder must be a valid subfolder of SiYuan assets.');
  }
  return path;
}

function localAssetPath(value) {
  if (typeof value !== 'string') return '';
  const path = value.startsWith('/assets/') ? value.slice(1) : value;
  if (!path.startsWith('assets/')) return '';
  try { return normalizeAssetFolder(path) === path ? path : ''; } catch { return ''; }
}

function cardImageSource(value, base) { return typeof value === 'string' && (value.startsWith('assets/') || value.startsWith('/assets/')) ? localAssetPath(value) : safeResource(value, base); }

function imageType(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x)) return ['png', 'image/png'];
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['jpg', 'image/jpeg'];
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return ['gif', 'image/gif'];
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return ['webp', 'image/webp'];
  if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, Math.min(bytes.length, 40)))) return ['avif', 'image/avif'];
  throw new Error('The downloaded thumbnail is not a supported image.');
}

async function limitedBytes(response) {
  if (!response.ok) throw new Error(`Image request returned ${response.status}.`);
  if (Number(response.headers?.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Thumbnail exceeds 8 MB.');
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Invalid thumbnail size.');
    return bytes;
  }
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_IMAGE_BYTES) throw new Error('Thumbnail exceeds 8 MB.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (!length) throw new Error('The thumbnail is empty.');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function bounded(task, ms, signal, cancel = () => {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const stop = () => { cancel(); finish(new Error('Thumbnail saving cancelled.')); };
    const finish = (error, value) => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      error ? reject(error) : resolve(value);
    };
    if (signal?.aborted) { stop(); return; }
    signal?.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => { cancel(); finish(new Error('Thumbnail saving timed out.')); }, Math.max(1, ms));
    Promise.resolve().then(task).then(value => finish(null, value), error => finish(error));
  });
}

async function saveThumbnail(image, { folder = DEFAULT_THUMBNAIL_FOLDER, post, browserFetch, signal, timeoutMs = 4500, crypto = globalThis.crypto } = {}) {
  if (localAssetPath(image)) return { saved: true, path: image };
  const url = normalizeURL(image);
  if (!url) return { saved: false, path: image, error: 'No web thumbnail is available.' };
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    if (signal?.aborted) throw new Error('Thumbnail saving cancelled.');
    const time = deadline - Date.now();
    if (time <= 0) throw new Error('Thumbnail saving timed out.');
    return time;
  };
  try {
    const destination = normalizeAssetFolder(folder);
    let bytes;
    if (browserFetch) {
      const controller = new AbortController();
      try {
        bytes = await bounded(async () => {
          const response = await browserFetch(url, { credentials: 'omit', redirect: 'follow', signal: controller.signal });
          const result = await limitedBytes(response); imageType(result); return result;
        }, Math.min(2500, Math.floor(remaining() * .6)), signal, () => controller.abort());
      } catch { /* Keep part of the deadline for the kernel fallback. */ }
      finally { controller.abort(); }
    }
    if (!bytes) {
      const response = await bounded(() => post('/api/network/forwardProxy', {
        url, method: 'GET', timeout: remaining(), responseEncoding: 'base64',
        headers: [{ Accept: 'image/avif,image/webp,image/*,*/*;q=0.5' }],
      }), remaining(), signal);
      const data = response?.data;
      if (response?.code !== 0 || !(data?.status >= 200 && data.status < 300) || !['base64', 'base64-std'].includes(data.bodyEncoding) || typeof data.body !== 'string' || data.body.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) {
        throw new Error('Could not download the thumbnail.');
      }
      bytes = Uint8Array.from(atob(data.body), char => char.charCodeAt(0));
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Invalid thumbnail size.');
    }
    const [extension, mime] = imageType(bytes);
    // Include the folder in the original filename: SiYuan's content deduplication
    // must not silently reuse a thumbnail from a different chosen directory.
    const hashInput = new Uint8Array(new TextEncoder().encode(`${destination}\n`).length + bytes.length);
    hashInput.set(new TextEncoder().encode(`${destination}\n`)); hashInput.set(bytes, hashInput.length - bytes.length);
    const digest = await bounded(() => crypto.subtle.digest('SHA-256', hashInput), remaining(), signal);
    const hash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
    const filename = `link-thumb-${hash.slice(0, 24)}.${extension}`;
    const form = new FormData();
    form.append('assetsDirPath', destination);
    form.append('file[]', new Blob([bytes], { type: mime }), filename);
    const uploaded = await bounded(() => post('/api/asset/upload', form), remaining(), signal);
    const path = uploaded?.data?.succMap?.[filename] || uploaded?.data?.succFiles?.[0]?.path;
    if (uploaded?.code !== 0 || !localAssetPath(path) || !path.startsWith(`${destination}/`)) throw new Error('Could not save the thumbnail in the chosen assets folder.');
    return { saved: true, path };
  } catch (error) { return { saved: false, path: image, error: error.message }; }
}

module.exports = { DEFAULT_THUMBNAIL_FOLDER, MAX_IMAGE_BYTES, normalizeAssetFolder, localAssetPath, cardImageSource, imageType, saveThumbnail };
