// Minimal host boundary for lifecycle tests. Actual Lute parsing/round trips
// are checked separately against the installed SiYuan engine.
const { DOMParser } = require('linkedom');
function hostLute() {
  if (process.env.SIYUAN_LUTE_PATH) {
    require(process.env.SIYUAN_LUTE_PATH);
    const lute = global.Lute.New();
    lute.SetSuperBlock(true); lute.SetKramdownIAL(true);
    lute.SetTextMark(true); lute.SetHTMLTag2TextMark(true); lute.SetProtyleWYSIWYG(true);
    return lute;
  }
  return { Md2BlockDOM(markdown) {
    const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    const card = doc.createElement('div'); card.setAttribute('data-type', 'NodeSuperBlock'); card.className = 'sb';
    card.setAttribute('data-node-id', markdown.match(/\n\{: id="([^"]+)" custom-link-paste=/)?.[1] || 'fixture-card');
    card.setAttribute('custom-link-paste', markdown.includes('custom-link-paste="pending"') ? 'pending' : 'card');
    card.setAttribute('custom-link-paste-mode', markdown.includes('custom-link-paste-mode="expanded"') ? 'expanded' : 'compact');
    const decode = value => value.replace(/\\(.)/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const paragraph = (role, content) => {
      const p = doc.createElement('div'); p.setAttribute('data-type', 'NodeParagraph'); p.setAttribute('data-node-id', `fixture-${role}`); p.setAttribute('custom-link-paste-role', role);
      const edit = doc.createElement('div'); edit.setAttribute('contenteditable', 'true'); edit.appendChild(content); p.appendChild(edit); card.appendChild(p); return p;
    };
    const link = markdown.match(/^\[(.*)\]\(<([^>]+)>(?: "(.*)")?\)$/m);
    if (!link) throw new Error('Unexpected host fixture input');
    const span = doc.createElement('span'); span.setAttribute('data-type', 'a'); span.setAttribute('data-href', link[2]); span.textContent = decode(link[1]);
    if (link[3]) span.setAttribute('data-title', decode(link[3]));
    const title = paragraph('title', span);
    const titleID = markdown.match(/\{: id="([^"]+)" custom-link-paste-role="title"/); if (titleID) title.setAttribute('data-node-id', titleID[1]);
    const description = markdown.match(/([^\n]+)\n\{: custom-link-paste-role="description"/);
    if (description) paragraph('description', doc.createTextNode(decode(description[1])));
    const image = markdown.match(/!\[Preview\]\(<([^>]+)>\)/);
    if (image) { const img = doc.createElement('img'); img.setAttribute('src', image[1]); paragraph('image', img); }
    const attr = doc.createElement('div'); attr.className = 'protyle-attr'; attr.setAttribute('contenteditable', 'false'); card.appendChild(attr);
    return card.outerHTML;
  } };
}
module.exports = { hostLute };
