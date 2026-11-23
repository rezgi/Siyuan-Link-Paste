const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/index.cjs')],
  outfile: path.join(root, 'dist/index.js'),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['siyuan', 'electron'],
  target: 'chrome120',
  minify: false,
});
for (const file of ['plugin.json', 'README.md', 'LICENSE', 'NOTICE.md']) {
  fs.copyFileSync(path.join(root, file), path.join(root, 'dist', file));
}
fs.cpSync(path.join(root, 'i18n'), path.join(root, 'dist/i18n'), { recursive: true });
console.log('Built dist/ for SiYuan 3.8.11+');
