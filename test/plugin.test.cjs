const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { parseHTML, DOMParser } = require('linkedom');
global.DOMParser = DOMParser;
const { hostLute } = require('./host-lute.cjs');

async function harness({ clipboard = 'https://example.com/', label = '', invalidTarget = false, code = false, pending = false, config, image = '' } = {}) {
  const inserted = [], messages = [], commands = [], released = [], updates = [], apiUpdates = [], assetUploads = [];
  let complete, seq = 0, savedDOM = '';
  const { document } = parseHTML('<html><body><div id="root"><div data-node-id="original" data-type="NodeParagraph"><div contenteditable="true"></div></div><div data-node-id="other" data-type="NodeParagraph"><div contenteditable="true">Other paragraph</div></div></div></body></html>');
  const root = document.getElementById('root');
  const originalBlock = root.firstElementChild;
  if (code) originalBlock.setAttribute('data-type', 'NodeCodeBlock');
  const editable = originalBlock.firstElementChild;
  const node = document.createTextNode(label);
  editable.appendChild(node);
  const originalRange = {
    startContainer: node, endContainer: node, startOffset: 0, endOffset: label.length, collapsed: !label,
    toString: () => label,
    cloneRange() { return { ...this }; },
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
  };
  const resolvedRange = { ...originalRange, tracked: true };
  let currentRange = originalRange;
  const editor = {
    protyle: { lute: hostLute(), wysiwyg: { element: root }, toolbar: { getCurrentType: () => [] }, options: {} },
    hasClosestBlock: node => (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-node-id]'),
    trackRange: () => 'handle',
    resolveTrackedRange: () => invalidTarget ? { status: 'invalid' } : { status: 'resolved', range: resolvedRange },
    releaseTrackedRange: x => released.push(x),
    flushPendingTransactions: async () => { const block = root.querySelector('[data-node-id="original"]'); savedDOM = block ? block.outerHTML : ''; },
    updateTransactionElement: (block, undo) => updates.push({ id: block.getAttribute('data-node-id'), html: block.outerHTML, undo }),
  };
  const post = (endpoint, data) => {
    if (endpoint === '/api/block/getBlockDOM') return Promise.resolve({ code: savedDOM ? 0 : -1, data: { dom: savedDOM } });
    if (endpoint === '/api/block/updateBlock') { apiUpdates.push(data); savedDOM = data.data; return Promise.resolve({ code: 0 }); }
    if (endpoint === '/api/asset/upload') { assetUploads.push(data); const file = data.get('file[]'); return Promise.resolve({ code: 0, data: { succMap: { [file.name]: `${data.get('assetsDirPath')}/${file.name}` } } }); }
    if (data?.responseEncoding === 'base64') return Promise.resolve({ code: 0, data: { status: 200, bodyEncoding: 'base64', body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' } });
    return pending ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ code: 0, data: { status: 200, body: `<title>Page &amp; title</title><meta property="og:description" content="Description">${image ? `<meta property="og:image" content="${image}">` : ''}` } });
  };
  const context = {
    module: { exports: {} }, console, AbortController, Set, WeakSet,
    window: { getSelection: () => ({ rangeCount: 1, getRangeAt: () => currentRange }), Lute: { NewNodeID: () => `test-${++seq}` } },
    navigator: { clipboard: { readText: async () => clipboard } }, document,
    require: name => name === 'siyuan' ? {
      Plugin: class { addCommand(x) { commands.push(x); } async loadData() { return config; } },
      Setting: class { addItem() {} }, showMessage: (...x) => messages.push(x),
      getActiveEditor: () => editor, fetchSyncPost: post,
      insertContent: options => {
        inserted.push(options);
        if (options.dataType === 'html') {
          const a = new DOMParser().parseFromString(options.data, 'text/html').querySelector('a');
          const span = document.createElement('span');
          span.setAttribute('data-type', 'a'); span.setAttribute('data-href', a.getAttribute('href')); span.setAttribute('data-title', a.getAttribute('title')); span.textContent = a.textContent;
          editable.replaceChildren(span);
        } else if (options.data.startsWith('<div')) {
          originalBlock.setAttribute('data-type', 'NodeHTMLBlock');
          const html = document.createElement('protyle-html'); html.setAttribute('data-content', options.data); originalBlock.replaceChildren(html);
        } else {
          const native = new DOMParser().parseFromString(editor.protyle.lute.Md2BlockDOM(options.data), 'text/html').querySelector('[data-type="NodeSuperBlock"]');
          originalBlock.setAttribute('data-type', 'NodeSuperBlock');
          originalBlock.setAttribute('custom-link-paste', 'pending');
          originalBlock.replaceChildren(...Array.from(native.childNodes));
        }
        return { status: 'inserted' };
      },
    } : require(`../src/${name.slice(2)}`),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/index.cjs'), 'utf8'), context);
  const plugin = new context.module.exports();
  await plugin.onload();
  return { plugin, editor, root, originalBlock, inserted, messages, commands, released, updates, apiUpdates, assetUploads, resolvedRange,
    moveAway: () => { const node = root.lastElementChild.firstElementChild.firstChild; currentRange = { startContainer: node, endContainer: node, toString: () => '' }; return currentRange; },
    currentRange: () => currentRange,
    complete: () => complete?.({ code: 0, data: { status: 200, body: `<title>Late title</title><meta property="og:description" content="Description">${image ? `<meta property="og:image" content="${image}">` : ''}` } }),
  };
}

test('registers two native configurable commands without a normal paste listener', async () => {
  const h = await harness();
  assert.deepEqual(h.commands.map(x => x.hotkey), ['⌘K', '⇧⌘K']);
  assert.ok(h.commands.every(x => typeof x.editorCallback === 'function'));
});

test('titled paste updates its placeholder and preserves custom selected text', async () => {
  const h = await harness({ label: 'My <label>' });
  await h.plugin.pasteURL(h.editor);
  assert.equal(h.inserted.length, 1);
  assert.equal(h.inserted[0].range, h.resolvedRange);
  assert.equal(h.originalBlock.querySelector('span').textContent, 'My <label>');
  assert.equal(h.originalBlock.querySelector('span').getAttribute('data-title'), 'Page & title');
  assert.equal(h.updates.length, 1);
  assert.ok(!h.updates[0].undo.includes('Fetching'));
});

test('card paste settles its native block group with a normal editable title link', async () => {
  const h = await harness();
  await h.plugin.pasteURL(h.editor, 'card');
  assert.equal(h.inserted.length, 1);
  assert.equal(h.originalBlock.getAttribute('data-type'), 'NodeSuperBlock');
  assert.equal(h.originalBlock.getAttribute('custom-link-paste'), 'card');
  const link = h.originalBlock.querySelector('span[data-type="a"]');
  assert.equal(link.textContent, 'Page & title');
  assert.equal(link.getAttribute('data-href'), 'https://example.com/');
  assert.equal(link.parentElement.getAttribute('contenteditable'), 'true');
  assert.equal(h.originalBlock.querySelector('protyle-html'), null);
  assert.ok(!h.originalBlock.outerHTML.includes('Fetching'));
  assert.ok(!h.updates[0].undo.includes('Fetching'));
});

test('HTML and native cards both save thumbnails to the configured assets folder', async () => {
  for (const cardFormat of ['native', 'html']) {
    const h = await harness({ config: { cardFormat, saveThumbnails: true, thumbnailFolder: 'media/test' }, image: 'https://example.com/image.png' });
    await h.plugin.pasteURL(h.editor, 'card');
    assert.equal(h.assetUploads.length, 1);
    assert.equal(h.assetUploads[0].get('assetsDirPath'), 'assets/media/test');
    if (cardFormat === 'html') {
      assert.equal(h.originalBlock.getAttribute('data-type'), 'NodeHTMLBlock');
      const html = h.originalBlock.querySelector('protyle-html').getAttribute('data-content');
      assert.match(html, /assets\/media\/test\/link-thumb-/);
      assert.ok(!html.includes('https://example.com/image.png'));
    } else {
      assert.equal(h.originalBlock.getAttribute('data-type'), 'NodeSuperBlock');
      assert.match(h.originalBlock.querySelector('img').getAttribute('src'), /^assets\/media\/test\/link-thumb-/);
    }
    assert.ok(!h.updates[0].undo.includes('Fetching'));
  }
});

test('local saving off keeps the remote thumbnail in both card formats', async () => {
  for (const cardFormat of ['native', 'html']) {
    const h = await harness({ config: { cardFormat }, image: 'https://example.com/image.png' });
    await h.plugin.pasteURL(h.editor, 'card');
    assert.equal(h.assetUploads.length, 0);
    assert.ok(h.originalBlock.outerHTML.includes('https://example.com/image.png'));
  }
});

test('the chosen card format stays fixed while fetching, even if settings change', async () => {
  for (const cardFormat of ['native', 'html']) {
    const h = await harness({ pending: true, config: { cardFormat } });
    const task = h.plugin.pasteURL(h.editor, 'card');
    await new Promise(resolve => setImmediate(resolve));
    const movedRange = h.moveAway();
    h.plugin.config.cardFormat = cardFormat === 'html' ? 'native' : 'html';
    h.complete(); await task;
    assert.equal(h.originalBlock.getAttribute('data-type'), cardFormat === 'html' ? 'NodeHTMLBlock' : 'NodeSuperBlock');
    assert.equal(h.currentRange(), movedRange);
    assert.ok(!h.originalBlock.outerHTML.includes('Fetching'));
  }
});

test('edited placeholders do not trigger thumbnail uploads in either format', async () => {
  for (const cardFormat of ['native', 'html']) {
    const h = await harness({ pending: true, config: { cardFormat, saveThumbnails: true }, image: 'https://example.com/image.png' });
    const task = h.plugin.pasteURL(h.editor, 'card');
    await new Promise(resolve => setImmediate(resolve));
    if (cardFormat === 'html') h.originalBlock.querySelector('protyle-html').setAttribute('data-content', '<div>My edit</div>');
    else h.originalBlock.querySelector('span[data-title]').textContent = 'My edit';
    h.complete(); await task;
    assert.equal(h.assetUploads.length, 0); assert.equal(h.updates.length, 0);
    assert.ok(h.originalBlock.outerHTML.includes('My edit'));
  }
});

test('an edited native card placeholder is left alone', async () => {
  const h = await harness({ pending: true });
  const task = h.plugin.pasteURL(h.editor, 'card');
  await new Promise(resolve => setImmediate(resolve));
  h.originalBlock.querySelector('span[data-title]').textContent = 'Edited while loading';
  h.complete(); await task;
  assert.equal(h.updates.length, 0);
  assert.equal(h.originalBlock.querySelector('span[data-title]').textContent, 'Edited while loading');
});

test('a selected bare URL is upgraded to the fetched page title', async () => {
  const h = await harness({ label: 'https://example.com/' });
  await h.plugin.pasteURL(h.editor);
  assert.equal(h.originalBlock.querySelector('span').textContent, 'Page & title');
});

test('bad clipboard, code context and invalid initial target never insert', async () => {
  for (const options of [{ clipboard: 'not a URL' }, { code: true }, { invalidTarget: true }]) {
    const h = await harness(options);
    await h.plugin.pasteURL(h.editor);
    assert.equal(h.inserted.length, 0);
  }
});

test('loading is visible before metadata returns, and moving away never redirects completion', async () => {
  for (const mode of ['title', 'card']) {
    const h = await harness({ pending: true });
    const task = h.plugin.pasteURL(h.editor, mode);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.inserted.length, 1);
    assert.match(h.inserted[0].data, /Fetching/);
    const movedRange = h.moveAway();
    h.root.lastElementChild.firstElementChild.textContent = 'Kept typing elsewhere';
    h.complete(); await task;
    assert.equal(h.currentRange(), movedRange);
    assert.equal(h.root.lastElementChild.textContent, 'Kept typing elsewhere');
    assert.equal(h.updates[0].id, 'original');
    assert.ok(!h.originalBlock.outerHTML.includes('Fetching'));
  }
});

test('edited placeholders are not overwritten', async () => {
  const h = await harness({ pending: true });
  const task = h.plugin.pasteURL(h.editor);
  await new Promise(resolve => setImmediate(resolve));
  h.originalBlock.querySelector('span').textContent = 'My edit';
  h.complete(); await task;
  assert.equal(h.originalBlock.querySelector('span').textContent, 'My edit');
  assert.equal(h.updates.length, 0);
});

test('a closed/unloaded editor updates the saved original block without current-caret insertion', async () => {
  const h = await harness({ pending: true });
  const task = h.plugin.pasteURL(h.editor, 'card');
  await new Promise(resolve => setImmediate(resolve));
  h.root.remove();
  h.complete(); await task;
  assert.equal(h.apiUpdates.length, 1);
  assert.equal(h.apiUpdates[0].id, 'original');
  assert.ok(!h.apiUpdates[0].data.includes('Fetching'));
  assert.equal(h.inserted.length, 1);
});

test('unloading cancels the lookup and leaves the URL without stale loading text', async () => {
  const h = await harness({ pending: true });
  const task = h.plugin.pasteURL(h.editor);
  await new Promise(resolve => setImmediate(resolve));
  h.plugin.onunload();
  h.complete(); await task;
  assert.equal(h.originalBlock.querySelector('span').textContent, 'https://example.com/');
  assert.equal(h.plugin.jobs.size, 0);
});

test('deleting the whole pending block is flushed before storage lookup and never resurrected', async () => {
  const h = await harness({ pending: true });
  const task = h.plugin.pasteURL(h.editor, 'card');
  await new Promise(resolve => setImmediate(resolve));
  h.originalBlock.remove();
  h.complete(); await task;
  assert.equal(h.updates.length, 0);
  assert.equal(h.apiUpdates.length, 0);
  assert.equal(h.root.querySelectorAll('[data-node-id]').length, 1);
});
