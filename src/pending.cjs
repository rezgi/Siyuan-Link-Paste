const { escapeHtml, buildCardHTML } = require('./render.cjs');
const { normalizeURL } = require('./metadata.cjs');

function makePending(url, mode, label, token) {
  const marker = `link-paste-pending:${token}`;
  const text = `Fetching ${url}…`;
  const html = mode === 'card'
    ? `<div data-link-paste-pending="${escapeHtml(marker)}" style="padding:12px;border:1px solid var(--b3-border-color,#80808055);border-radius:8px">Fetching <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>…</div>`
    : `<a href="${escapeHtml(url)}" title="${escapeHtml(marker)}">${escapeHtml(text)}</a>`;
  return { url, mode, label, marker, text, html, blockID: null, settled: false };
}

function findPending(root, pending) {
  if (pending.mode === 'card') {
    return Array.from(root.querySelectorAll('protyle-html')).find(node => node.getAttribute('data-content') === pending.html);
  }
  return Array.from(root.querySelectorAll('span[data-title]')).find(node =>
    node.getAttribute('data-title') === pending.marker &&
    node.getAttribute('data-href') === pending.url &&
    node.textContent.replace(/\u200b/g, '') === pending.text);
}

function closestBlock(node) {
  return node?.closest('[data-node-id]');
}

function applyResult(node, pending, meta, config, rawURL = false) {
  if (pending.mode === 'card') {
    const content = rawURL
      ? `<div><a href="${escapeHtml(pending.url)}">${escapeHtml(pending.url)}</a></div>`
      : buildCardHTML(meta, pending.url, config.cardMode);
    // Native protyle-html observes this attribute and rerenders itself.
    node.setAttribute('data-content', content);
  } else {
    const customLabel = pending.label && normalizeURL(pending.label) !== pending.url;
    node.textContent = rawURL ? (customLabel ? pending.label : pending.url) : (customLabel ? pending.label : meta.title || pending.url);
    if (!rawURL && config.replaceTitle) node.setAttribute('data-title', meta.title || pending.url);
    else node.removeAttribute('data-title');
  }
}

async function settlePending(editor, pending, meta, config, post) {
  if (pending.settled || !pending.blockID) return false;
  const root = editor.protyle.wysiwyg.element;
  let node = root.isConnected ? findPending(root, pending) : null;
  let block = closestBlock(node);
  const native = !!block;
  if (!node) {
    // An edited or deleted placeholder in the current DOM belongs to the user.
    // Only consult storage if the block was unloaded/virtualized or tab closed.
    if (root.isConnected && root.querySelector(`[data-node-id="${pending.blockID}"]`)) {
      pending.settled = true;
      return false;
    }
    // A missing block can be a just-queued deletion. Commit it before reading
    // storage so a stale saved placeholder cannot resurrect deleted content.
    await editor.flushPendingTransactions();
    const response = await post('/api/block/getBlockDOM', { id: pending.blockID });
    if (response?.code !== 0 || typeof response.data?.dom !== 'string') return false;
    const doc = new DOMParser().parseFromString(response.data.dom, 'text/html');
    node = findPending(doc, pending);
    block = closestBlock(node);
    if (!node || !block) { pending.settled = true; return false; }
  }
  // An undo of completion should return to the URL, not an eternal Fetching label.
  const undoBlock = block.cloneNode(true);
  const undoNode = findPending(undoBlock, pending);
  applyResult(undoNode, pending, meta, config, true);
  applyResult(node, pending, meta, config);
  if (native) {
    editor.updateTransactionElement(block, undoBlock.outerHTML);
    pending.settled = true;
    await editor.flushPendingTransactions();
  } else {
    const response = await post('/api/block/updateBlock', { id: block.getAttribute('data-node-id'), dataType: 'dom', data: block.outerHTML });
    if (response?.code !== 0) throw new Error('Could not update the unloaded preview block');
    pending.settled = true;
  }
  return true;
}

module.exports = { makePending, findPending, closestBlock, settlePending };
