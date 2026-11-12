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
  - **Forgot password?** emails a one-time reset link to her recovery address.
- **Aquarium theme.** An optional animated backdrop: bubbles, swaying seaweed and five kinds of fish. See below.

No database and no build step. Content is one JSON file (`data/content.json`) plus a folder of uploads (`data/uploads/`). **Back up the `data/` folder and you've backed up the whole site.**

## Install on a server

**Step-by-step for an IONOS VPS** (SSH, SFTP, remote desktop, several sites on one server, email): see [`docs/ionos.md`](docs/ionos.md).

Grab the latest bundle from **Releases**. It's ready to run, with dependencies included and **no content**, so the site starts blank and everything is added from `/admin`.

```bash
tar xzf portfolio-vX.Y.Z.tar.gz && cd portfolio-vX.Y.Z
cp .env.example .env          # fill in: TLS_MODE, DOMAIN, LETSENCRYPT_EMAIL, ADMIN_PASSWORD
docker compose up -d --build  # then: docker compose logs -f
```

To run without Docker, use `node server.js` (Node 18+) or the systemd unit in `deploy/portfolio.service`.

**Upgrading:** unpack the new release over the old folder. Keep `data/` (content, uploads, password and certificates) and `.env`.

### HTTPS / your own domain (Let's Encrypt, built in)

The app gets and renews its own Let's Encrypt certificate, so you don't need nginx or Caddy.

1. **DNS.** At the registrar, add A records (and AAAA records for IPv6) pointing at the server:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | server's public IP |
   | A | `www` | server's public IP |

2. **Ports.** 80 and 443 must be open to the internet (firewall/router). Let's Encrypt checks ownership over port 80.

3. **`.env`:**
   ```ini
   TLS_MODE=letsencrypt
   DOMAIN=nanarium.com,www.nanarium.com
   LETSENCRYPT_EMAIL=you@example.com
   LETSENCRYPT_STAGING=true     # first run only, see below
   ```

4. Start it and watch the log. You should see `certificate saved` and `HTTPS on :443`. Once a staging certificate works, set `LETSENCRYPT_STAGING=false` and restart to get the real one. The staging run protects you from Let's Encrypt's rate limits while you're getting DNS right.

How it behaves:

- Certificates are stored in `data/certs/`.
- They're checked twice a day and renewed 30 days before expiry, with no restart needed.
- Plain HTTP redirects to HTTPS.
- Until the first certificate arrives, the site stays reachable over HTTP. If a request fails, the log says why and it retries (15 min, 30 min, 1 h … up to 12 h).
- Adding a name to `DOMAIN` triggers a new certificate on the next start.

Other modes:

- `TLS_MODE=manual` + `TLS_CERT` / `TLS_KEY`: use your own certificate files. The app reloads them when they change, e.g. after certbot renews.
- `TLS_MODE=off`: plain HTTP. Use it for local testing, Cloudflare Tunnel, or a proxy in front. A Caddy setup is in `deploy/docker-compose.caddy.yml`; set `TRUST_PROXY=true` behind any proxy.

**Home server?** Forward 80 and 443 on the router to the machine. If the ISP blocks those ports, use a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) with `TLS_MODE=off` instead.

### Local development

```bash
npm install
ADMIN_PASSWORD=dev npm run dev     # http://localhost:3000, admin at /admin
```

## Making a release

`.github/workflows/release.yml` does the following:

1. Builds the bundle (`.tar.gz`, `.zip` and `SHA256SUMS.txt`).
2. Smoke-tests a blank boot.
3. Publishes a GitHub Release.

To trigger it, either:

- push a tag: `git tag v1.0.0 && git push origin v1.0.0`, or
- go to **Actions → Release → Run workflow** and enter a version.

Versions with a dash (e.g. `v1.1.0-beta.1`) are marked as pre-releases.

## Settings (environment variables)

Put these in `.env` (Docker or systemd both read it).

| Variable | Default | |
|---|---|---|
| `ADMIN_PASSWORD` | random, printed at start | First admin password. Once it's changed in Admin → Site, the new one (stored hashed in `data/auth.json`) wins. Forgot it? Delete `data/auth.json` and restart. |
| `TLS_MODE` | `off` | `letsencrypt`, `manual` or `off` |
| `DOMAIN` | | Comma-separated names for the certificate |
| `LETSENCRYPT_EMAIL` | | Contact for Let's Encrypt |
| `LETSENCRYPT_STAGING` | `false` | Test against the staging CA |
| `TLS_CERT` / `TLS_KEY` | | PEM files for `TLS_MODE=manual` |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | Ports when TLS is on |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Port when TLS is off |
| `DATA_DIR` | `./data` | Content, uploads, password, certificates |
| `MAX_UPLOAD_MB` | `1024` | Per-file upload limit |
| `SESSION_HOURS` | `168` | How long an admin login lasts |
| `TRUST_PROXY` | `false` | `true` behind Caddy/nginx/Cloudflare |
| `SMTP_HOST` | `localhost` | Mail server for reset links and alerts; `off` disables email |
| `SMTP_PORT` / `SMTP_SECURE` | `25` / `false` | `587` for submission, `465` + `true` for implicit TLS |
| `SMTP_USER` / `SMTP_PASS` | | Login, if the mail server needs one |
| `MAIL_FROM` | `Portfolio <noreply@DOMAIN>` | Sender address |
| `ADMIN_EMAIL` | | Fallback recovery address. The client sets her own in Admin → Site. |
| `SITE_URL` | `https://<first DOMAIN>` | Base for links in emails |
| `SECURE_COOKIE` | `false` | Force secure cookies (automatic with TLS or `TRUST_PROXY`) |

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
tls.js                 HTTPS: Let's Encrypt (acme-client) / manual certs / off
public/index.html      site shell
public/css/site.css    site styles
public/js/site.js      carousel, windows, routing, media players, lightbox
public/js/aquarium.js  aquarium backdrop (bubbles, seaweed, fish)
public/admin/          admin UI
deploy/                systemd units (single site, multi-site template), optional Caddy files
docs/ionos.md          server setup guide
mail.js                outgoing email (nodemailer)
.env.example           all server settings (HTTPS, domain, password)
.github/workflows/     release workflow
```
