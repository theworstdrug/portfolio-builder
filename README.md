# Portfolio

A small, self-hosted portfolio site:

- **Looping vertical menu.** Big type, centred on the active item. Scroll, swipe, or use ↑/↓ (or j/k), and it wraps from the bottom back to the top.
- **Pop-up windows.** Click a section or press **Enter** to slide open a window with its projects. **Esc** or `(Close)` closes it. Switching sections crossfades the content. Every window has its own URL (`/#/print`, `/#/print/speed-bump-fort-worth`), so links can be shared and the back button works.
- **Media.** Images, video, audio (with a minimal type-only player) and PDFs. Images open in a full-screen viewer with ←/→. Videos can be set to autoplay silently on loop, GIF-style.
- **Tags.** Tag projects and individual media. Tags are clickable, `/#/tag/name` shows everything with that tag, and an optional "Tag index" section lists every tag.
- **Portfolio odds and ends.** Per-project detail rows (Client, Year, Medium, Dimensions…), external links, captions/credits/alt text, draft projects, hidden sections, `(More…)` collapsed projects, grid/stacked/full-bleed media layouts, external-link menu items, text-only menu items, an auto-updating "last updated" date, and editable footer links and colours.
- **Admin at `/admin`.** Password-protected. Drag-and-drop uploads, a media library with search/type/tag filters, and section/project editing. **Ctrl/⌘+S** saves.

No database and no build step. Content is one JSON file (`data/content.json`) plus a folder of uploads (`data/uploads/`). **Back up the `data/` folder and you've backed up the whole site.**

## Run it

Requires Node 18+.

```bash
npm install
ADMIN_PASSWORD=something-long npm start
# → http://localhost:3000   admin: http://localhost:3000/admin
```

On first start, `data/content.json` is created from `content.example.json`.

### With Docker (VPS / home server)

```bash
# edit ADMIN_PASSWORD in docker-compose.yml first
docker compose up -d --build
```

Data persists in `./data` next to the compose file.

### Without Docker

See `deploy/portfolio.service` (systemd) and `deploy/Caddyfile` (reverse proxy with automatic HTTPS). For a home server, point a domain (or a Cloudflare Tunnel / Tailscale Funnel) at Caddy.

When serving over HTTPS, set `SECURE_COOKIE=true` and `TRUST_PROXY=true`.

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `ADMIN_PASSWORD` | random, printed at start | Admin password. Set this. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `DATA_DIR` | `./data` | Where content.json and uploads live |
| `MAX_UPLOAD_MB` | `1024` | Per-file limit. Raise your proxy's limit too |
| `SESSION_HOURS` | `168` | How long an admin login lasts |
| `SECURE_COOKIE` | `false` | `true` behind HTTPS |
| `TRUST_PROXY` | `false` | `true` behind Caddy/nginx (for login rate-limiting by real IP) |

## Editing content

Most editing happens in `/admin`:

- **Sections** are the menu lines, in order. Each one has a type:
  - **Projects:** the normal window.
  - **Tag index:** lists all tags.
  - **External link:** opens a URL.
  - **Label only:** decorative text.
- **Projects** live inside a section. Descriptions support blank-line paragraphs, `**bold**`, `*italic*` and `[text](https://…)`, and bare URLs and emails become links automatically.
- **Media** can be uploaded in the Media tab (with tags applied to the batch) or straight onto a project with "+ Upload". Click any media item to edit its caption, credit, alt text and tags.
- **Site** holds the colophon (the last menu line), the footer links, the "last updated" text, colours and the font.

You can also hand-edit `data/content.json`. Stop the server first, since it keeps content in memory.

### Custom font

Put the font file in `public/fonts/` and add an `@font-face` at the top of `public/css/site.css`. Then enter the family name in Admin → Site → Font stack, e.g. `"My Grotesk", Helvetica, sans-serif`.

### Tweaking the look/motion

All of it is in `public/css/site.css`. Things you might change:

- `--menu-size`: menu type size.
- `--ease`: animation curve.
- The `mask-image` gradient on `.menu`: the fade at the top and bottom.
- `.panel` `width`: window width.

The carousel feel is set in `public/js/site.js`:

- `dt * 11` in `tick()`: spring speed.
- `0.16` in `render()`: how fast lines fade with distance.

## File map

```
server.js              API + static files + uploads (Express, Multer)
content.example.json   starter content
public/index.html      site shell
public/css/site.css    site styles
public/js/site.js      carousel, windows, routing, media players, lightbox
public/admin/          admin UI
deploy/                systemd unit + Caddyfile
```
