**English** | [繁體中文](README.md)

# JRead

A clean reading-mode extension for Chrome, Firefox, and Safari. One click hides ads, sidebars, popups, and floating elements, extracts the main article, and applies clean typography — so a page becomes just its text and images.

It works on article-centric pages: news sites, blogging platforms, Wikipedia, technical docs, and the like. When no main article can be detected, JRead does nothing rather than force a layout that would break the original page.

**Current version**: see the top entry in [CHANGELOG.md](CHANGELOG.md).

---

## Overview

JRead is built around three things: **find the article**, **remove the noise**, and **make it readable**. On top of that it adds reading habits — paged reading, position memory, and read-later service integration. Desktop and mobile (including iOS Safari) share the same settings.

### Reading mode core

- **Article detection**: tries `<article>`, then Schema.org markup, then a content-density heuristic to locate the real article block
- **One-click toggle**: enter and exit reading mode from the toolbar menu, the floating button, a keyboard shortcut, or a three-finger tap
- **Clean typography**: adjustable font, size, weight (light / regular / bold), line height, and content width; a width self-check makes sure body text, headings, and category rows all fill the configured width instead of being pinched by the original site's wrappers
- **Latin font override**: when the font is set to serif or sans-serif, you can pick a separate Latin font for letters and numbers while Chinese keeps its serif / sans rendering; each mode remembers its own choice. Alongside system fonts, five variable fonts ship built in (Literata, Source Serif, Piazzolla, Public Sans, Source Sans), available across platforms including iOS

### Noise handling

- **Noise hiding**: automatically removes ads, sticky headers, popups, and related-article lists
- **Edit mode**: manually remove leftover noise the cleaner missed, so the article is cleaner when **printing** or **sending to a read-later service**. In reading mode, select a section to remove and one click hides it; mistakes can be undone with Cmd/Ctrl+Z. Removals last only for the session (they return on exit or reload), and removed sections appear in neither the printout nor what is sent to a read-later service

### Reading experience

- **Themes**: light, dark, and sepia
- **Two reading modes (pick one)**: the default is **scroll mode** (ordinary vertical scrolling); it can be switched to **paged mode** in settings — flip left/right like an e-book, swiping on phones or using arrow keys / the scroll wheel on desktop, with images scaled to fit a single page. The page-number footer doubles as a scrubber: hold and drag to jump through pages, with a progress bar and per-page haptic feedback while dragging
- **Paragraph focus scrolling (scroll mode only)**: an indicator on the left marks the current paragraph; press Space to jump to the next one, and paragraphs below a threshold smoothly scroll back toward the top (threshold adjustable); not applicable in paged mode
- **Position memory**: leave an article partway through (exit reading mode, close the tab, restart the browser) and JRead remembers where you were — the paragraph in scroll mode, the page in paged mode — restoring it on re-entry within the retention window (adjustable; default 3 days, max 7, 0 to disable)

### Read-later integration

- **Readwise Reader or Instapaper (pick one)**: after choosing a service in advanced settings, send JRead's cleaned article in one click, bypassing the destination's own parser. Instapaper uses the official Full API (xAuth — enter email/password once to exchange for a token, the password is discarded), Readwise uses an access token
- **Enter Reader**: list the chosen service's latest articles in a new tab and open them in JRead's own reading layout, reusing the same theme / font / size / paging controls and remembering your position; each item can be archived in one click. Top tabs switch per service: Readwise shows Inbox / Later / JRead (items tagged `jread`), Instapaper shows Unread / Starred / Archive
- **Summary on send**: optionally use Google Gemini Flash Lite to generate an article summary at send time (replacing Readwise's built-in English summary, or filling Instapaper's item description); requires your own Gemini API key, shared by both services

### Controls

- **Floating button**: a small persistent icon at the edge of the page — tap to toggle reading mode, long-press for a menu, drag to reposition to either edge and up/down; opacity and size are adjustable, or it can be turned off
- **Three-finger tap**: on touch devices, tap with three fingers to toggle reading mode (off by default, can be enabled in settings)
- **Custom shortcuts**: record key combinations for toggle reading mode / send to read-later service / YouTube borderless mode; Safari (including an iPad external keyboard) has no browser-level rebinding entry, so this is the only path there, and it works on Chrome too
- **Reset to defaults**: restore all settings to their defaults in one click (with a confirmation step), while keeping the Readwise / Gemini API keys and the Instapaper connection

See [SPEC.md](SPEC.md) for the full specification.

---

## Development

- Full specification: [SPEC.md](SPEC.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
