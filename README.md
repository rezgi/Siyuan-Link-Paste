# Link Paste

Paste URLs as titled links or expandable preview cards in SiYuan 3.8.11+.

## Use

Install and enable **Link Paste** in **Settings → Marketplace → Plugins**.
Copy a URL, place the cursor in your document, then use:

| Paste as | Default Windows shortcut |
| --- | --- |
| Titled link | Ctrl+K |
| Preview card | Ctrl+Shift+K |

Change shortcuts in **Settings → Keymap → Link Paste**. Reassign any conflicting
shortcut there. Both commands also appear in the command panel; Ctrl+V stays unchanged.
Select text first to keep it as the link label.

## Useful options

- **Card format:** choose native editable blocks or a self-contained HTML block.
- **Offline thumbnails:** optionally save images to SiYuan assets. Off by default;
  the default folder is `assets/_link_thumbs`, and you can choose another assets subfolder.
- **Keep writing:** the URL appears immediately with “Fetching…”, then updates
  in its original position, even after you leave the block.
- **No endless loading:** the timeout defaults to 4.5 seconds and is adjustable.
  Failed lookups keep the URL.
- **Compact or large cards:** choose the default in settings. Native cards use
  the ⤢ button; HTML cards expand when you click their body.
- **Editable links:** use SiYuan’s usual link panel on the card title. For an old
  HTML card, choose **Convert to native link card** from its block menu first.

## Changelog

- **2026-11-24 · v0.1.6:** native editable cards, optional saved thumbnails and
  custom folder, native/HTML choice, thumbnail hover fix and new plugin images.
- **2026-11-23 · v0.1.3:** first public release, with titled links, preview cards,
  loading placeholders and improved cursor handling.

MIT licensed. [Credits](NOTICE.md) · [Full changelog](CHANGELOG.md)
