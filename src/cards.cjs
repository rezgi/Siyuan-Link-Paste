const { normalizeURL } = require('./metadata.cjs');
const { cardImageSource } = require('./assets.cjs');

const CARD = '[data-type="NodeSuperBlock"][custom-link-paste="card"]';
const PENDING = '[data-type="NodeSuperBlock"][custom-link-paste="pending"]';
function plain(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function mdText(value) { return plain(value).replace(/[\\`*_[\]{}()#+.!|<>~-]/g, '\\$&'); }
function destination(value) { return value.replace(/</g, '%3C').replace(/>/g, '%3E'); }
function quote(value) { return plain(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function cardMarkdown(meta, url, mode, { id, titleID, marker, pending = false, tooltip = true } = {}) {
  const label = pending ? `Fetching ${url}…` : plain(meta.title) || url;
  const title = pending ? marker : tooltip ? plain(meta.title) || url : '';
  const blocks = [`[${mdText(label)}](<${destination(url)}>${title ? ` "${quote(title)}"` : ''})\n{: ${titleID ? `id="${titleID}" ` : ''}custom-link-paste-role="title"}`];
  if (!pending && plain(meta.description)) blocks.push(`${mdText(meta.description)}\n{: custom-link-paste-role="description"}`);
  const image = !pending && cardImageSource(meta.image, url);
  if (image) blocks.push(`![Preview](<${destination(image)}>)\n{: custom-link-paste-role="image"}`);
  return `{{{row\n${blocks.join('\n\n')}\n}}}\n{: ${id ? `id="${id}" ` : ''}custom-link-paste="${pending ? 'pending' : 'card'}" custom-link-paste-mode="${mode === 'expanded' ? 'expanded' : 'compact'}"}`;
}

function nativeCard(meta, url, mode, options, lute) {
  if (!lute?.Md2BlockDOM) throw new Error('Native card rendering needs the editor Markdown engine');
  const parsed = new DOMParser().parseFromString(lute.Md2BlockDOM(cardMarkdown(meta, url, mode, options)), 'text/html');
  const card = parsed.querySelector(CARD);
  if (!card || parsed.querySelector('[data-type="NodeHTMLBlock"]')) throw new Error('Could not render a native link card');
  if (options?.id) card.setAttribute('data-node-id', options.id);
  // Lute can split entity-containing link text into adjacent marks. Keep a
  // single native mark and assign metadata as text, never as HTML.
  const link = parsed.createElement('span');
  link.setAttribute('data-type', 'a'); link.setAttribute('data-href', url);
  link.textContent = plain(meta.title) || url;
  if (options?.tooltip !== false) link.setAttribute('data-title', plain(meta.title) || url);
  card.querySelector('[custom-link-paste-role="title"] > [contenteditable="true"]').replaceChildren(link);
  const description = card.querySelector('[custom-link-paste-role="description"] > [contenteditable="true"]');
  if (description) description.textContent = plain(meta.description);
  return card;
}

function cardRoot(node, includePending = false) { return node?.closest?.(includePending ? `${CARD},${PENDING}` : CARD); }

function legacyCard(block) {
  if (block?.getAttribute('data-type') !== 'NodeHTMLBlock') return null;
  const source = block.querySelector('protyle-html')?.getAttribute('data-content');
  if (!source) return null;
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const link = doc.querySelector('a[href]');
  const url = normalizeURL(link?.getAttribute('href'));
  const wrapper = doc.querySelector('div[style*="border:"][style*="border-radius:"]');
  const description = doc.querySelector('div[style*="-webkit-line-clamp"]');
  if (!url || !wrapper?.contains(link) || !link.getAttribute('style')?.includes('font-weight:600')) return null;
  return { url, mode: doc.querySelector('details[open]') ? 'expanded' : 'compact', meta: {
    title: link.textContent, description: description?.textContent || '',
    image: doc.querySelector('img[loading="lazy"]')?.getAttribute('src') || '',
  } };
}

async function convertLegacy(editor, block) {
  const legacy = legacyCard(block);
  if (!legacy || editor.protyle.disabled || editor.protyle.options?.readOnly) return false;
  const oldHTML = block.outerHTML;
  const card = nativeCard(legacy.meta, legacy.url, legacy.mode, { id: block.getAttribute('data-node-id') }, editor.protyle.lute);
  // Keep unrelated user attributes on the converted container.
  for (const attr of Array.from(block.attributes)) if (attr.name.startsWith('custom-') && !attr.name.startsWith('custom-link-paste')) card.setAttribute(attr.name, attr.value);
  block.replaceWith(card);
  editor.updateTransactionElement(card, oldHTML);
  await editor.flushPendingTransactions();
  return true;
}

async function toggleCard(editor, card) {
  if (!card?.matches(CARD) || editor.protyle.disabled || editor.protyle.options?.readOnly) return false;
  const oldHTML = card.outerHTML;
  card.setAttribute('custom-link-paste-mode', card.getAttribute('custom-link-paste-mode') === 'expanded' ? 'compact' : 'expanded');
  editor.updateTransactionElement(card, oldHTML);
  await editor.flushPendingTransactions();
  return true;
}

function installCardControls(plugin, { getAllEditor, showMessage }) {
  let frame = null;
  const editorFor = card => getAllEditor().find(editor => editor.protyle.wysiwyg?.element?.contains(card));
  const sync = () => {
    frame = null;
    for (const card of document.querySelectorAll(CARD)) {
      const attr = Array.from(card.children).find(child => child.classList.contains('protyle-attr'));
      if (!attr) continue;
      let button = attr.querySelector('button[data-link-paste-toggle]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button'; button.setAttribute('data-link-paste-toggle', '');
        button.setAttribute('contenteditable', 'false');
        button.textContent = '⤢'; attr.appendChild(button);
      }
      const expanded = card.getAttribute('custom-link-paste-mode') === 'expanded';
      const label = expanded ? 'Compact link card' : 'Expand link card';
      if (button.getAttribute('aria-label') !== label) { button.setAttribute('aria-label', label); button.setAttribute('title', label); button.setAttribute('aria-expanded', String(expanded)); }
    }
  };
  const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(sync); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['custom-link-paste', 'custom-link-paste-mode'] });
  const click = event => {
    const button = event.target.closest?.('button[data-link-paste-toggle]');
    if (!button) return;
    const card = cardRoot(button), editor = editorFor(card);
    if (!editor) return;
    event.preventDefault(); event.stopPropagation();
    void toggleCard(editor, card).catch(error => { console.error('Link Paste card toggle failed', error); showMessage('Could not change the card display.', 3500, 'error'); });
  };
  const menu = ({ detail }) => {
    const editor = detail.protyle.getInstance();
    const cards = [...new Set(detail.blockElements.map(block => cardRoot(block)).filter(Boolean))];
    if (cards.length === 1) detail.menu.addItem({ icon: 'iconFullscreen', label: cards[0].getAttribute('custom-link-paste-mode') === 'expanded' ? 'Compact link card' : 'Expand link card', click: () => toggleCard(editor, cards[0]) });
    const legacy = detail.blockElements.filter(block => legacyCard(block));
    if (legacy.length) detail.menu.addItem({ icon: 'iconLink', label: 'Convert to native link card', click: async () => {
      try { for (const block of legacy) await convertLegacy(editor, block); }
      catch (error) { console.error('Link Paste card conversion failed', error); showMessage('Could not convert the link card.', 3500, 'error'); }
    } });
  };
  document.addEventListener('click', click, true);
  plugin.eventBus.on('click-blockicon', menu);
  sync();
  return () => {
    observer.disconnect(); if (frame !== null) window.cancelAnimationFrame(frame);
    document.removeEventListener('click', click, true); plugin.eventBus.off('click-blockicon', menu);
    document.querySelectorAll('button[data-link-paste-toggle]').forEach(button => button.remove());
  };
}

module.exports = { cardMarkdown, nativeCard, cardRoot, legacyCard, convertLegacy, toggleCard, installCardControls };
