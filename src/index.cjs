const { Plugin, Setting, fetchSyncPost, showMessage, getActiveEditor, insertContent } = require('siyuan');
const { normalizeURL, fetchMetadata, fallbackMeta } = require('./metadata.cjs');
const { makePending, findPending, closestBlock, settlePending } = require('./pending.cjs');
const { resolvePasteRange } = require('./position.cjs');

const DEFAULTS = { cardMode: 'compact', timeoutMs: 4500, replaceTitle: true, useOEmbed: false };
const STORAGE = 'config.json';

module.exports = class LinkPastePlugin extends Plugin {
  async onload() {
    this.disposed = false;
    this.jobs = new Set();
    this.config = { ...DEFAULTS };
    this.setupSettings();
    for (const [langKey, hotkey, mode] of [
      ['pasteTitledLink', '⌘K', 'title'],
      ['pasteLinkCard', '⇧⌘K', 'card'],
    ]) {
      this.addCommand({
        langKey, hotkey,
        editorCallback: (protyle, context) => {
          void this.pasteURL(protyle.getInstance(), mode, context?.range);
        },
      });
    }
    try {
      const saved = await this.loadData(STORAGE);
      if (saved) this.config = {
        cardMode: saved.cardMode === 'expanded' ? 'expanded' : 'compact',
        timeoutMs: Math.max(1000, Math.min(15000, Number(saved.timeoutMs) || DEFAULTS.timeoutMs)),
        replaceTitle: saved.replaceTitle !== false,
        useOEmbed: saved.useOEmbed === true,
      };
    } catch (error) { console.error('Link Paste: could not load settings', error); }
  }

  setupSettings() {
    const fields = {};
    this.setting = new Setting({
      confirmCallback: async () => {
        const next = { ...this.config };
        for (const [key, field] of Object.entries(fields)) {
          next[key] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value;
        }
        next.timeoutMs = Math.max(1000, Math.min(15000, next.timeoutMs || DEFAULTS.timeoutMs));
        await this.saveData(STORAGE, next);
        this.config = next;
      },
    });
    this.setting.addItem({
      title: 'Keyboard shortcuts',
      description: 'Change “Paste titled link” (Ctrl+K) and “Paste link card” (Ctrl+Shift+K) in Settings → Keymap → Link Paste. Reassign a conflicting built-in shortcut there if needed.',
      createActionElement: () => document.createElement('span'),
    });
    for (const [key, title, description, type] of [
      ['cardMode', 'Default card display', 'Cards can be expanded or collapsed by clicking their body.', 'select'],
      ['timeoutMs', 'Metadata timeout (milliseconds)', 'One deadline for all fetch attempts. On timeout, keep the URL or insert a minimal card.', 'number'],
      ['replaceTitle', 'Set the link tooltip too', 'Store the fetched page title in the link title attribute.', 'checkbox'],
      ['useOEmbed', 'Use noembed.com fallback', 'Optional: sends the pasted URL to noembed.com when page metadata is incomplete.', 'checkbox'],
    ]) {
      this.setting.addItem({ title, description, createActionElement: () => {
        const field = document.createElement(type === 'select' ? 'select' : 'input');
        if (type === 'select') {
          field.innerHTML = '<option value="compact">Compact</option><option value="expanded">Expanded</option>';
        } else { field.type = type; }
        field.className = type === 'checkbox' ? 'b3-switch' : type === 'select' ? 'b3-select' : 'b3-text-field';
        if (type === 'checkbox') field.checked = this.config[key];
        else field.value = this.config[key];
        if (type === 'number') { field.min = '1000'; field.max = '15000'; field.step = '500'; }
        fields[key] = field;
        return field;
      } });
    }
  }

  async readURL() {
    let text;
    if (typeof navigator.clipboard?.readText === 'function') {
      text = await navigator.clipboard.readText();
    } else if (typeof window.require === 'function') {
      text = window.require('electron').clipboard.readText();
    } else { throw new Error('Clipboard unavailable'); }
    return normalizeURL(text);
  }

  async pasteURL(editor = getActiveEditor(), mode = 'title', commandRange) {
    if (this.disposed || !editor?.protyle) return;
    const inner = editor.protyle;
    const selection = window.getSelection();
    const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const range = resolvePasteRange(inner.wysiwyg.element, currentRange, commandRange);
    if (!range) {
      showMessage('Place the cursor in the document first.', 3500, 'info');
      return;
    }
    if (inner.disabled || inner.options?.readOnly) return;
    const startBlock = editor.hasClosestBlock(range.startContainer);
    const endBlock = editor.hasClosestBlock(range.endContainer);
    if (!startBlock || !endBlock) {
      showMessage('Place the cursor inside an editable text paragraph.', 3500, 'info');
      return;
    }
    if (startBlock !== endBlock) {
      showMessage('Select text within one block, or place the cursor where you want the link.', 3500, 'info');
      return;
    }
    if (startBlock.getAttribute('data-type') === 'NodeCodeBlock' || inner.toolbar.getCurrentType(range).includes('code')) {
      showMessage('The cursor is in code formatting. Move outside the code to paste a link preview.', 3500, 'info');
      return;
    }
    const label = range.toString();
    let handle;
    try { handle = editor.trackRange(range, { owner: this, affinity: 'before' }); }
    catch { showMessage('This position does not support Link Paste.', 3500, 'info'); return; }
    const controller = new AbortController();
    const job = { editor, handle, controller, pending: null };
    this.jobs.add(job);
    try {
      const url = await this.readURL();
      if (!url) { showMessage('Copy one http:// or https:// URL first.', 3500, 'info'); return; }
      if (this.disposed) return;
      const config = { ...this.config };
      job.config = config;
      const target = editor.resolveTrackedRange(handle);
      if (target.status !== 'resolved') return;
      const pending = makePending(url, mode, label, window.Lute.NewNodeID());
      const result = insertContent({ editor, range: target.range, dataType: mode === 'card' ? 'markdown' : 'html', data: pending.html });
      if (result.status !== 'inserted') {
        showMessage(`Link Paste could not insert here (${result.status}).`, 4000, 'info');
        return;
      }
      job.pending = pending;
      const placeholder = findPending(inner.wysiwyg.element, pending);
      const placeholderBlock = closestBlock(placeholder);
      if (!placeholderBlock) throw new Error('Could not locate the inserted preview placeholder');
      pending.blockID = placeholderBlock.getAttribute('data-node-id');
      // The visible placeholder owns the result now. Caret movement is free.
      editor.releaseTrackedRange(handle);
      job.handle = null;
      await editor.flushPendingTransactions();
      if (this.disposed || controller.signal.aborted) return;
      const meta = await fetchMetadata(url, {
        post: fetchSyncPost, timeoutMs: config.timeoutMs,
        browserFetch: typeof window.require === 'function' ? globalThis.fetch?.bind(globalThis) : undefined,
        card: mode === 'card', useOEmbed: config.useOEmbed, signal: controller.signal,
      });
      if (this.disposed || controller.signal.aborted) return;
      const updated = await settlePending(editor, pending, meta, config, fetchSyncPost);
      if (updated && !meta.foundTitle) {
        const blocked = meta.attempts.some(attempt => [401, 403, 429].includes(attempt.status));
        showMessage(blocked ? 'This site blocked the preview request. Kept the URL.' : 'No page title was available. Kept the URL.', 4500, 'info');
      }
    } catch (error) {
      console.error('Link Paste failed', error);
      if (!this.disposed) showMessage('Link Paste could not finish the preview. The URL is kept when possible.', 4500, 'error');
    } finally {
      controller.abort();
      if (job.handle) editor.releaseTrackedRange(job.handle);
      if (job.pending && !job.pending.settled) {
        try { await settlePending(editor, job.pending, fallbackMeta(job.pending.url), job.config, fetchSyncPost); }
        catch (error) { console.error('Link Paste could not clear loading status', error); }
      }
      this.jobs.delete(job);
    }
  }

  onunload() {
    this.disposed = true;
    for (const job of this.jobs || []) {
      job.controller.abort();
      if (job.handle) job.editor.releaseTrackedRange(job.handle);
    }
    this.jobs?.clear();
  }
};
