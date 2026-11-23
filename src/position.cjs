function inRoot(root, range) {
  return !!range && range.startContainer?.isConnected && range.endContainer?.isConnected &&
    root.contains(range.startContainer) && root.contains(range.endContainer);
}

function editableFor(root, node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  const editable = element?.closest('[contenteditable]');
  return editable && editable !== root && editable.getAttribute('contenteditable') === 'true' && root.contains(editable) ? editable : null;
}

function insideChild(root, child, end) {
  if (!child) return null;
  const own = editableFor(root, child);
  if (own) return { node: child, offset: end ? (child.nodeType === 3 ? child.textContent.length : child.childNodes.length) : 0 };
  if (child.nodeType !== 1) return null;
  const editables = Array.from(child.querySelectorAll('[contenteditable="true"]'))
    .filter(editable => editableFor(root, editable) === editable);
  const editable = end ? editables.at(-1) : editables[0];
  return editable ? { node: editable, offset: end ? editable.childNodes.length : 0 } : null;
}

function boundary(root, node, offset, end, collapsed) {
  if (editableFor(root, node)) return { node, offset };
  if (node.nodeType !== 1) return null;
  // Range.selectNode(paragraph), list navigation and focus restoration can
  // describe the caret on the parent container instead of inside its text.
  if (collapsed || !end) {
    const next = insideChild(root, node.childNodes[offset], false);
    if (next) return next;
  }
  if (collapsed || end) {
    const previous = insideChild(root, node.childNodes[offset - 1], true);
    if (previous) return previous;
  }
  // A block wrapper itself may have editing controls before its text child.
  if (node !== root && node.hasAttribute('data-node-id')) return insideChild(root, node, end);
  return null;
}

function normalizeRange(root, range) {
  if (!inRoot(root, range)) return null;
  const start = boundary(root, range.startContainer, range.startOffset, false, range.collapsed);
  const end = range.collapsed ? start : boundary(root, range.endContainer, range.endOffset, true, false);
  if (!start || !end) return null;
  const result = range.cloneRange();
  try {
    result.setStart(start.node, start.offset);
    result.setEnd(end.node, end.offset);
    return result;
  } catch { return null; }
}

function resolvePasteRange(root, currentRange, commandRange) {
  // A live selection takes precedence; a captured command range can have been
  // moved onto a container by focus changes or DOM replacement.
  return normalizeRange(root, currentRange) || normalizeRange(root, commandRange);
}

module.exports = { normalizeRange, resolvePasteRange };
