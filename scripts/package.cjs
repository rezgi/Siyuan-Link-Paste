const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { zipSync, unzipSync } = require('fflate');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'plugin.json'), 'utf8'));
assert.equal(manifest.url, 'https://github.com/rezgi/Siyuan-Link-Paste');
assert.equal(manifest.name, 'siyuan-link-paste');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, `v${manifest.version}`);
for (const key of ['displayName', 'description', 'readme']) {
  assert.ok(manifest[key]?.default, `${key}.default is required`);
  for (const locale of Object.keys(manifest[key])) assert.ok(!locale.includes('_'), `Use BCP 47 locale keys: ${locale}`);
}
const files = {};
function collect(dir, prefix = '') {
  for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    assert.ok(!item.isSymbolicLink(), 'Symlinks are not supported in marketplace packages');
    const name = prefix + item.name;
    if (item.isDirectory()) collect(path.join(dir, item.name), `${name}/`);
    else files[name] = [fs.readFileSync(path.join(dir, item.name)), { mtime: new Date('2026-01-01T00:00:00Z') }];
  }
}
collect(dist);
const archive = zipSync(files, { level: 9 });
const extracted = unzipSync(archive);
for (const required of ['index.js', 'plugin.json', 'README.md', 'LICENSE', 'NOTICE.md', 'i18n/en_US.json', 'i18n/zh_CN.json']) {
  assert.ok(extracted[required], `Missing ${required} at archive root`);
  assert.deepEqual(Buffer.from(extracted[required]), fs.readFileSync(path.join(dist, required)));
}
for (const filename of Object.keys(extracted)) {
  assert.ok(!filename.includes('\\') && !filename.startsWith('/') && !filename.split('/').includes('..'));
  assert.ok(!/(?:^|\/)(?:node_modules|src|test|\.git)(?:\/|$)/.test(filename));
}
fs.writeFileSync(path.join(root, 'package.zip'), archive);
console.log(`Validated package.zip: v${manifest.version}, ${Object.keys(extracted).length} files, ${archive.length} bytes`);
