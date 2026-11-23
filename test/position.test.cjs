const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { normalizeRange, resolvePasteRange } = require('../src/position.cjs');

function range(startContainer, startOffset, endContainer = startContainer, endOffset = startOffset) {
  return {
    startContainer, startOffset, endContainer, endOffset,
    collapsed: startContainer === endContainer && startOffset === endOffset,
    cloneRange() { return { ...this }; },
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
  };
}
function fixture() {
  const { document } = parseHTML('<html><body><div id="root"><div data-node-id="first" data-type="NodeParagraph"><div contenteditable="true">First</div></div><div data-node-id="second" data-type="NodeParagraph"><div contenteditable="true">Second</div></div></div></body></html>');
  const root = document.getElementById('root');
  return { root, first: root.firstElementChild.firstElementChild, second: root.lastElementChild.firstElementChild };
}

test('a collapsed caret on the editor boundary resolves to the indicated paragraph', () => {
  const { root, second } = fixture();
  const normalized = normalizeRange(root, range(root, 1));
  assert.equal(normalized.startContainer, second);
  assert.equal(normalized.startOffset, 0);
  assert.equal(normalized.endContainer, second);
});

test('selecting a whole paragraph through its parent preserves that one-block selection', () => {
  const { root, first } = fixture();
  const normalized = normalizeRange(root, range(root, 0, root, 1));
  assert.equal(normalized.startContainer, first);
  assert.equal(normalized.startOffset, 0);
  assert.equal(normalized.endContainer, first);
  assert.equal(normalized.endOffset, first.childNodes.length);
});

test('list-container boundaries resolve to their actual editable paragraph', () => {
  const { root } = fixture();
  root.setAttribute('contenteditable', 'false');
  root.innerHTML = '<div data-node-id="list" data-type="NodeList"><div data-node-id="item" data-type="NodeListItem"><div data-node-id="paragraph" data-type="NodeParagraph"><div contenteditable="true">List text</div></div></div></div>';
  const normalized = normalizeRange(root, range(root, 0));
  assert.equal(normalized.startContainer.textContent, 'List text');
  assert.equal(normalized.startContainer.getAttribute('contenteditable'), 'true');
});

test('a current live caret wins over a command snapshot in another block', () => {
  const { root, first, second } = fixture();
  const resolved = resolvePasteRange(root, range(second.firstChild, 3), range(first.firstChild, 0));
  assert.equal(resolved.startContainer, second.firstChild);
  assert.equal(resolved.startOffset, 3);
});

test('a valid captured range is retained when current selection is outside the editor', () => {
  const { root, first } = fixture();
  const resolved = resolvePasteRange(root, range(root.ownerDocument.body, 0), range(first.firstChild, 2));
  assert.equal(resolved.startContainer, first.firstChild);
});

test('real cross-block selections remain cross-block; detached ranges are rejected', () => {
  const { root, first, second } = fixture();
  const resolved = normalizeRange(root, range(first.firstChild, 0, second.firstChild, 2));
  assert.equal(resolved.startContainer, first.firstChild);
  assert.equal(resolved.endContainer, second.firstChild);
  const detached = range(first.firstChild, 0);
  root.firstElementChild.remove();
  assert.equal(normalizeRange(root, detached), null);
});
