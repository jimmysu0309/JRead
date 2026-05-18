# JRead Firefox — Build Instructions for AMO Reviewers

This document explains how to rebuild the submitted Firefox extension ZIP
(`jread-firefox-vX.Y.Z.zip`) from the accompanying source ZIP
(`jread-firefox-vX.Y.Z-source.zip`).

The build process is **trivial**: a single `jq` invocation patches a few
lines of JSON in `manifest.json`. There is **no** minification, bundling,
transpilation, or any other code transformation. All `.js` / `.css` / `.html`
files in the submitted ZIP are byte-for-byte identical to the source.

---

## Prerequisites

- bash 3.2+
- [jq](https://jqlang.org/) 1.6+
- `zip` (standard on Linux / macOS; Windows: install via WSL or Git Bash)

Install jq:

```bash
# macOS
brew install jq

# Ubuntu / Debian
sudo apt-get install jq

# Windows (winget)
winget install jqlang.jq
```

---

## Build Steps

1. Extract the source ZIP. After extraction you should see:
   ```
   jread/
     manifest.json
     background/
     content/
     popup/
     options/
     assets/
     ...
   tools/
     firefox-build.sh
   BUILD.md  (this file)
   LICENSE
   ```

2. Run the build script from the extracted root directory:

   ```bash
   chmod +x tools/firefox-build.sh
   ./tools/firefox-build.sh
   ```

3. Output: `jread-firefox-vX.Y.Z.zip` in the current directory,
   matching the submitted Firefox ZIP byte-for-byte (modulo ZIP timestamp
   metadata).

---

## What the Build Does

The repository's `jread/manifest.json` is the **Chrome version**
(declares `background.service_worker`). Chrome MV3 rejects the
`background.scripts` key with a warning ("requires manifest version 2 or
lower"). Firefox MV3 does not support `background.service_worker` at all.
The two browsers' rules are mutually incompatible, so a single manifest
cannot serve both.

The build performs exactly one transformation, applied via `jq`:

```bash
jq '.background = {"scripts": ["popup/popup-core.js", "background/service-worker.js"]} |
    .browser_specific_settings.gecko.strict_min_version = "128.0" |
    .browser_specific_settings.gecko.data_collection_permissions = {"required": ["none"]}' \
    jread/manifest.json > firefox-build/manifest.json
```

This:

1. Replaces `background.service_worker` with `background.scripts`
   (Firefox's required form for MV3 event-page-style background pages).
   The script ordering is significant: `popup/popup-core.js` must load
   before `background/service-worker.js` because the latter depends on
   the helper functions defined in the former. On Chrome the same dependency
   is expressed via `importScripts('/popup/popup-core.js')` inside the
   service worker (guarded with `typeof importScripts === 'function'` so
   the call is a no-op in Firefox's event-page context).
2. Adds `browser_specific_settings.gecko.strict_min_version: "128.0"`
   (the lower bound Mozilla recommends for stable MV3 behaviour).
3. Adds `browser_specific_settings.gecko.data_collection_permissions: {"required": ["none"]}`
   (Mozilla's 2025 built-in data-consent rule. JRead does NOT collect
   any user data — Readwise Reader integration calls go directly from
   the user's browser to the Readwise API with the user-supplied token;
   no JRead-controlled server is involved.)

All other files (`background/*.js`, `content/*.js`, `popup/*`,
`options/*`, icons, CSS) are copied unchanged.

---

## Verifying the Build Output

After running `tools/firefox-build.sh`, verify the patched manifest:

```bash
unzip -p jread-firefox-vX.Y.Z.zip manifest.json | jq '{version, background, browser_specific_settings}'
```

Expected output:

```json
{
  "version": "X.Y.Z",
  "background": {
    "scripts": [
      "popup/popup-core.js",
      "background/service-worker.js"
    ]
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "jread@jimmy.zm.su",
      "strict_min_version": "128.0",
      "data_collection_permissions": {
        "required": ["none"]
      }
    }
  }
}
```

---

## Source Repository

Public repository: https://github.com/jimmysu0309/JRead

The Chrome version (`jread/manifest.json` as-is) is the canonical
source of truth. The Firefox build script lives in `tools/firefox-build.sh`
and is also invoked by `.github/workflows/release.yml` for CI reproducibility.

License: see `LICENSE` in the repo.

---

## AMO Source Submission Questionnaire — Quick Answers

For convenience, the typical AMO source submission form answers:

| Question | Answer |
|---|---|
| Do you use any tools to compile / minify / process source? | Yes — `jq` only, to patch a few lines of JSON in `manifest.json`. No JS / CSS / HTML transformation. |
| Are there any third-party libraries? | None. All code is first-party. |
| Build environment | bash + jq + zip (any Linux / macOS / WSL) |
| How to reproduce | `./tools/firefox-build.sh` (see steps above) |
