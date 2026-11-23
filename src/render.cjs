// Adapted from Amin's local Card Link plugin. See LICENSE and NOTICE.md.
const { safeResource } = require("./metadata.cjs");
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    // Raw blank lines terminate Markdown HTML blocks, even inside text.
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");
}

function buildCardHTML(meta, url, mode) {
  const t = escapeHtml(meta.title || meta.domain || url);
  const d = escapeHtml(meta.description);
  const dm = escapeHtml(meta.domain);
  const safeUrl = escapeHtml(url);
  const img = safeResource(meta.image, url) ? escapeHtml(safeResource(meta.image, url)) : "";
  const fav = safeResource(meta.favicon, url) ? escapeHtml(safeResource(meta.favicon, url)) : "";
  const expandable = !!img || !!d;

  const S = {
    wrap: "border:1px solid var(--b3-border-color,#80808055);border-radius:8px;overflow:hidden",
    summary: "list-style:none;display:block;cursor:pointer",
    strip: "display:flex;flex-direction:row;max-height:140px;position:relative",
    body: "flex:1;padding:12px 16px;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px",
    title:
      "font-size:15px;font-weight:600;line-height:1.4;color:var(--b3-theme-on-background,inherit);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;text-decoration:none;display:block",
    desc: "font-size:13px;line-height:1.45;color:var(--b3-theme-on-surface,inherit);opacity:.75;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden",
    footer:
      "display:flex;align-items:center;gap:6px;font-size:12px;color:var(--b3-theme-on-surface,inherit);opacity:.55;margin-top:2px",
    favicon: "width:14px;height:14px;border-radius:2px",
    thumb: `width:clamp(80px,25vw,200px);min-width:80px;object-fit:cover`,
    hint: "position:absolute;top:6px;right:6px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:4px;background:var(--b3-theme-surface,#80808022);color:var(--b3-theme-on-surface,inherit);opacity:.5;font-size:12px",
    bigImgLink: "display:block;text-decoration:none",
    bigImg: `display:block;width:100%;height:clamp(10rem,28vw,22rem);object-fit:cover`,
    fullDesc:
      "padding:12px 16px;font-size:13px;line-height:1.55;color:var(--b3-theme-on-surface,inherit);opacity:.85",
  };

  const strip = `<div style="${S.strip}"><div style="${S.body}"><a href="${safeUrl}" title="${safeUrl}" style="${S.title}">${t}</a>${d ? `<div style="${S.desc}">${d}</div>` : ""}<div style="${S.footer}">${fav ? `<img src="${fav}" style="${S.favicon}">` : ""}<span>${dm}</span></div></div>${img ? `<img src="${img}" alt="" loading="lazy" style="${S.thumb}">` : ""}${expandable ? `<div style="${S.hint}" title="Click card to expand/collapse">⤢</div>` : ""}</div>`;

  if (!expandable) {
    return `<div style="${S.wrap}">${strip}</div>`;
  }

  return `<div style="${S.wrap}"><details${mode === "expanded" ? " open" : ""}><summary style="${S.summary}">${strip}</summary>${img ? `<a href="${safeUrl}" style="${S.bigImgLink}"><img src="${img}" alt="" loading="lazy" style="${S.bigImg}"></a>` : ""}${d ? `<div style="${S.fullDesc}">${d}</div>` : ""}</details></div>`;
}


module.exports = { escapeHtml, buildCardHTML };
