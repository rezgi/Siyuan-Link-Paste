# Link Paste

Dedicated clipboard URL commands for SiYuan 3.8.11 and later.

## Install

In SiYuan, open **Settings → Marketplace → Plugins**, search for **Link Paste**,
then install and enable it once the marketplace listing is available.

For manual installation, download `package.zip` from the
[latest release](https://github.com/rezgi/Siyuan-Link-Paste/releases/latest).
Extract its contents into `<your-workspace>/data/plugins/siyuan-link-paste/`
and enable **Link Paste** in the downloaded plugins list.

## Use

| Command | Default Windows shortcut |
| --- | --- |
| Paste titled link | Ctrl+K |
| Paste link card | Ctrl+Shift+K |

Change either binding in **Settings → Keymap → Link Paste**. SiYuan may already
use Ctrl+K for its link command; clear or reassign that conflicting binding
if SiYuan reports a conflict. Both commands also appear in the command panel.
Normal Ctrl+V is unchanged.

Copy one HTTP(S) URL (or www. URL), put the cursor in a document, and invoke
the command. Selecting text before titled paste keeps that text as the label.
Cards use the existing compact horizontal preview, with native expand/collapse;
the plugin settings can make cards expanded by default.

The URL appears immediately with a Fetching label, then that placeholder is
replaced by the titled link or card. You can move to another paragraph or tab
while it loads. Edited/deleted placeholders are left alone. Multiple pastes can
load independently, and finishing a fetch does not move the caret.

Metadata requests have one total deadline (4.5 seconds by default). On failure,
the original URL remains as the label or a minimal card. An invalid
or non-URL clipboard leaves the document unchanged. Code and cross-block
selections are rejected. Undoing completion returns to the URL without a stale
Fetching label. Background updates target the saved placeholder, never the new
cursor position.

On desktop, requests use Chromium fetch first, then SiYuan's kernel proxy as a
fallback. This matters for sites such as Udemy that reject the proxy's HTTP client.
Both paths share the metadata deadline; failed lookups display a message.
The optional noembed.com fallback
is off by default; turning it on sends pasted URLs to that service. Card images
and favicons load from the source URLs; YouTube cards can use YouTube thumbnails.
Cards are stored HTML blocks and remain readable without the plugin.

## Development

Requires Node.js 24 or later.

```sh
npm ci
npm test
npm run package
```

`npm run build` produces `dist/`; `npm run package` also creates and validates
the marketplace archive `package.zip`. For local development, copy `dist/`
into `<your-workspace>/data/plugins/siyuan-link-paste/` and reload the plugin.

Tests that exercise SiYuan's own Markdown engine run when `SIYUAN_LUTE_PATH`
points to an installed SiYuan `resources/stage/protyle/js/lute/lute.min.js`.
They are reported as skipped when the engine is unavailable. Other tests run
without SiYuan. Runtime integration has been checked on Windows desktop
SiYuan 3.8.11; other declared desktop platforms have not been manually verified.

## Releases

Update `version` in both `package.json` and `plugin.json`, refresh the lockfile,
commit the changes, and push a tag such as `v0.1.4`. The release workflow checks
that the tag matches the manifests, runs tests, and publishes `package.zip`.

## Credits and license

MIT licensed. Inspired by Titled Url and adapted from a locally extended Card
Link implementation. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).
