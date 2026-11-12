# Portfolio

A small, self-hosted portfolio site:

- **Looping vertical menu.** Big type, centred on the active item. Scroll, swipe, or use ↑/↓ (or j/k), and it wraps from the bottom back to the top.
- **Pop-up windows.** Click a section or press **Enter** to slide open a window with its projects. **Esc** or `(Close)` closes it. Switching sections crossfades the content. Every window has its own URL (`/#/print`, `/#/print/speed-bump-fort-worth`), so links can be shared and the back button works.
- **Media.** Images, video, audio (with a minimal type-only player) and PDFs. Images open in a full-screen viewer with ←/→. Videos can be set to autoplay silently on loop, GIF-style.
- **Tags.** Tag projects and individual media. Tags are clickable, `/#/tag/name` shows everything with that tag, and an optional "Tag index" section lists every tag.
- **Portfolio odds and ends.** Per-project detail rows (Client, Year, Medium, Dimensions…), external links, captions/credits/alt text, draft projects, hidden sections, `(More…)` collapsed projects, grid/stacked/full-bleed media layouts, external-link menu items, text-only menu items, an auto-updating "last updated" date, and editable footer links and colours.
- **Admin at `/admin`.** Built so the site owner can run it alone:
  - Changes **save automatically**.
  - Drag-and-drop uploads, plus a media library with search/type/tag filters.
  - A plain-language **Help** tab.
  - Change your password, and download a backup of the text.
  - If the login expires, a pop-up asks for the password without losing any edits.
- **Aquarium theme.** An optional animated backdrop: bubbles, swaying seaweed and five kinds of fish. See below.

No database and no build step. Content is one JSON file (`data/content.json`) plus a folder of uploads (`data/uploads/`). **Back up the `data/` folder and you've backed up the whole site.**

## Run it

Requires Node 18+.

```bash
npm install
ADMIN_PASSWORD=something-long npm start
# → http://localhost:3000   admin: http://localhost:3000/admin
```

On first start, `data/content.json` is created from `content.example.json`.

### With Docker + your own domain (recommended)

The compose file runs the site behind [Caddy](https://caddyserver.com), which gets and renews HTTPS certificates for your domain automatically.

1. **Point the domain at the server.** At the domain registrar (where nanarium was bought), open the DNS settings and add:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | your server's public IP |
   | A | `www` | your server's public IP |

   (Also add AAAA records if the server has IPv6.) DNS changes can take a few minutes to an hour to take effect.

2. **Configure and start:**
   ```bash
   cp .env.example .env      # set DOMAIN=nanarium.com, www.nanarium.com and ADMIN_PASSWORD
   docker compose up -d --build
   ```

3. Open `https://nanarium.com/admin`.

Ports 80 and 443 must be reachable from the internet. Content lives in `./data` next to the compose file.

**No domain yet?** Leave `DOMAIN=:80` and the site is served over plain HTTP at the server's IP.

**Home server?** Forward ports 80 and 443 on the router to the machine. If the ISP blocks those ports or the IP keeps changing, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) instead: point the tunnel at `http://localhost:3000`, uncomment `ports` for the `portfolio` service, and skip Caddy.

### Without Docker

See `deploy/portfolio.service` (systemd) and `deploy/Caddyfile`. Run Caddy with `DOMAIN=nanarium.com caddy run --config deploy/Caddyfile`. Then set `TRUST_PROXY=true` on the app, so logins use secure cookies over HTTPS.

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `ADMIN_PASSWORD` | random, printed at start | First admin password. Once it's changed in Admin → Site, the new one (stored hashed in `data/auth.json`) wins. Forgot it? Delete `data/auth.json` and restart. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `DATA_DIR` | `./data` | Where content.json and uploads live |
| `MAX_UPLOAD_MB` | `1024` | Per-file limit. Raise your proxy's limit too |
| `SESSION_HOURS` | `168` | How long an admin login lasts |
| `TRUST_PROXY` | `false` | `true` behind Caddy/nginx (real visitor IPs, secure cookies on HTTPS) |
| `SECURE_COOKIE` | `false` | Force secure cookies even without `TRUST_PROXY` |

## Editing content

Most editing happens in `/admin` (changes save automatically):

- **Sections** are the menu lines, in order. Each one has a type:
  - **Projects:** the normal window.
  - **Tag index:** lists all tags.
  - **External link:** opens a URL.
  - **Label only:** decorative text.
- **Projects** live inside a section. Descriptions support blank-line paragraphs, `**bold**`, `*italic*` and `[text](https://…)`, and bare URLs and emails become links automatically.
- **Media** can be uploaded in the Media tab (with tags applied to the batch) or straight onto a project with "+ Upload". Click any media item to edit its caption, credit, alt text and tags.
- **Site** holds the colophon (the last menu line), the footer links, the "last updated" text, colours and the font.

You can also hand-edit `data/content.json`. Stop the server first, since it keeps content in memory.

## Aquarium theme

**Admin → Site → Aquarium theme** has three modes:

- **Off:** gone, with no switch.
- **Optional:** off until a visitor turns it on.
- **On:** visitors can turn it off.

Visitors get an `(Aquarium on/off)` switch in the footer, and their choice lasts for their visit (sessionStorage).

Everything works without any images, using simple drawn placeholders. To use your own art, upload images in the admin:

| Element | Image notes |
|---|---|
| Backdrop | Any image. It covers the screen, on top of the two water colours. |
| Bubbles | Optional small round PNG. The amount runs from 0 to 100. |
| Seaweed | Tall transparent PNG/WebP with the base at the bottom. It's sliced into bands that sway, so it bends. Several images are used in turn. You also set the number of strands, the height, and the % drawn **in front of** the menu text. |
| Fish types | Transparent PNG/WebP facing one direction (tell it which). **Animation:** put frames side by side in one horizontal strip and set *Frames* and *FPS*. Each type also has a count, size, speed, layer (behind or in front of the menu) and placeholder colour. |

Fish behaviours:

- **Cruiser:** swims back and forth, drifts up and down, and scatters from the cursor.
- **School:** a group that follows an invisible leader.
- **Darter:** hovers, then darts somewhere new.
- **Drifter:** jellyfish-style. It pulses up, sinks slowly, and wraps from top to bottom.
- **Bottom walker:** walks the floor and pauses (crab, snail…).

The engine is `public/js/aquarium.js` (canvas, no dependencies). Its styles are under "aquarium theme" in `site.css`. Visitors with *reduced motion* enabled get a still frame.

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
public/js/aquarium.js  aquarium backdrop (bubbles, seaweed, fish)
public/admin/          admin UI
deploy/                Caddyfile (used by docker compose) + systemd unit
.env.example           domain + password for docker compose
```
