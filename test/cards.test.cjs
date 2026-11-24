const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser, parseHTML } = require('linkedom');
global.DOMParser = DOMParser;
const { cardMarkdown, nativeCard, legacyCard, convertLegacy, toggleCard } = require('../src/cards.cjs');
const { buildCardHTML } = require('../src/render.cjs');
const { hostLute } = require('./host-lute.cjs');

test('native cards escape metadata Markdown and reject executable image URLs', () => {
  const md = cardMarkdown({ title: 'A [link](javascript:bad)\n{: bad="yes"}', description: '<script>alert(1)</script>\n\n# Heading', image: 'javascript:alert(1)' }, 'https://example.com/', 'expanded');
  assert.ok(md.includes('\\[link\\]'));
  assert.ok(!md.includes('<script>'));
  assert.ok(!md.includes('![Preview]'));
  assert.equal((md.match(/\n\{: /g) || []).length, 3);
});

test('converting a legacy card preserves its block ID, URL, text and undo source', async () => {
  const { document } = parseHTML('<html><body><div data-node-id="legacy" data-type="NodeHTMLBlock" custom-note="keep"><protyle-html></protyle-html></div></body></html>');
  const block = document.querySelector('[data-node-id]');
  block.firstElementChild.setAttribute('data-content', buildCardHTML({ title: 'A title', description: 'Full\n\ndescription', image: 'https://example.com/image.png' }, 'https://example.com/', 'expanded'));
  const original = block.outerHTML;
  const updates = [];
  const editor = { protyle: { lute: hostLute(), options: {} }, updateTransactionElement: (card, old) => updates.push([card, old]), flushPendingTransactions: async () => {} };
  assert.ok(legacyCard(block));
  assert.equal(await convertLegacy(editor, block), true);
  const card = document.querySelector('[custom-link-paste="card"]');
  assert.equal(card.getAttribute('data-node-id'), 'legacy');
  assert.equal(card.getAttribute('custom-note'), 'keep');
  assert.equal(card.getAttribute('custom-link-paste-mode'), 'expanded');
  assert.equal(card.querySelector('[data-type="a"]').getAttribute('data-href'), 'https://example.com/');
  assert.equal(card.querySelector('[custom-link-paste-role="description"] > [contenteditable]').textContent, 'Full description');
  assert.equal(updates[0][1], original);
  await toggleCard(editor, card);
  assert.equal(card.getAttribute('custom-link-paste-mode'), 'compact');
  assert.ok(updates[1][1].includes('custom-link-paste-mode="expanded"'));
});

test('ordinary HTML is not offered as a legacy card; readonly cards are not changed', async () => {
  const { document } = parseHTML('<html><body><div data-type="NodeHTMLBlock"><protyle-html></protyle-html></div></body></html>');
  document.querySelector('protyle-html').setAttribute('data-content', '<div><a href="https://example.com">ordinary link</a></div>');
  assert.equal(legacyCard(document.querySelector('div')), null);
  const card = nativeCard({ title: 'Title' }, 'https://example.com/', 'compact', {}, hostLute());
  assert.equal(await toggleCard({ protyle: { disabled: true } }, card), false);
  assert.equal(card.getAttribute('custom-link-paste-mode'), 'compact');
});

test('actual SiYuan Lute round trip preserves native links, images, roles and display mode', { skip: !process.env.SIYUAN_LUTE_PATH }, () => {
  const lute = hostLute();
  const card = nativeCard({ title: 'A [title] & <value>', description: 'Line one\n\nLine two', image: 'https://example.com/cover.png' }, 'https://example.com/?a=1&b=2', 'expanded', { id: '20261124000000-abcdefg' }, lute);
  assert.equal(card.querySelectorAll('[data-type="NodeHTMLBlock"]').length, 0);
  const link = card.querySelector('[data-type="a"]');
  assert.equal(link.textContent, 'A [title] & <value>');
  assert.equal(link.getAttribute('data-href'), 'https://example.com/?a=1&b=2');
  assert.ok(card.querySelector('[data-type="img"] img'));
  card.querySelector('.protyle-attr').innerHTML = '<button data-link-paste-toggle="">⤢</button>';
  const md = lute.BlockDOM2Md(card.outerHTML);
  assert.ok(!md.includes('<button'));
  assert.ok(!md.includes('⤢'));
  const restored = new DOMParser().parseFromString(lute.Md2BlockDOM(md), 'text/html').querySelector('[custom-link-paste="card"]');
  assert.equal(restored.getAttribute('custom-link-paste-mode'), 'expanded');
  assert.equal(restored.getAttribute('data-node-id'), '20261124000000-abcdefg');
  assert.equal(Array.from(restored.querySelectorAll('[data-type="a"]')).map(a => a.textContent).join(''), link.textContent);
  assert.ok(restored.querySelector('[custom-link-paste-role="image"] img'));
  const local = nativeCard({ title: 'Local image', image: 'assets/_link_thumbs/test.png' }, 'https://example.com/', 'compact', {}, lute);
  const localRoundTrip = new DOMParser().parseFromString(lute.Md2BlockDOM(lute.BlockDOM2Md(local.outerHTML)), 'text/html');
  assert.equal(localRoundTrip.querySelector('img').getAttribute('src'), 'assets/_link_thumbs/test.png');
});
