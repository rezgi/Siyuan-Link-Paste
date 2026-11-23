# Changelog

## 0.1.3

Initial public release, following local testing and acceptance.

- Configurable titled-link and preview-card paste commands.
- Immediate URL loading placeholders that update without moving the caret.
- Compact and expanded preview cards with descriptions, images and favicons.
- Desktop fetching with a kernel proxy fallback and a shared timeout.
- Preserve custom labels, and replace selected bare URLs with their page titles.
- Keep multiline metadata inside one native HTML block.
- Normalize paragraph/list boundary selections and prefer the live caret.

Local regression coverage: 30 passing tests with SiYuan's Lute engine available.
