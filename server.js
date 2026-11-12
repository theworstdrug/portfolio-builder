'use strict';
/*
 * Portfolio server.
 * - Content lives in DATA_DIR/content.json (safe to hand-edit while the server is stopped).
 * - Uploaded files live in DATA_DIR/uploads.
 * - /admin is protected by ADMIN_PASSWORD.
 */
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 1024);
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 24 * 7);
const SECURE_COOKIE = process.env.SECURE_COOKIE === 'true';

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  console.warn(`\n[!] ADMIN_PASSWORD is not set. Temporary password for this run: ${ADMIN_PASSWORD}\n`);
}

/* ---------- file types ---------- */
const TYPES = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],
  audio: ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus'],
  document: ['.pdf'],
};
function typeForExt(ext) {
  for (const [type, exts] of Object.entries(TYPES)) if (exts.includes(ext)) return type;
  return null;
}

/* ---------- storage ---------- */
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CONTENT_FILE)) {
  fs.copyFileSync(path.join(__dirname, 'content.example.json'), CONTENT_FILE);
  console.log(`Created ${CONTENT_FILE} from content.example.json`);
}
let db; // loaded below, after the validators are defined

let writeChain = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(db, null, 2);
  writeChain = writeChain.then(async () => {
    const tmp = CONTENT_FILE + '.tmp';
    await fsp.writeFile(tmp, snapshot);
    await fsp.rename(tmp, CONTENT_FILE);
  }).catch((err) => console.error('Failed to save content:', err));
  return writeChain;
}

/* ---------- validation / normalisation ---------- */
const id = () => crypto.randomBytes(6).toString('hex');
const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const bool = (v) => v === true || v === 'true';
const slugify = (s) => str(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const tagList = (v) => {
  const arr = Array.isArray(v) ? v : str(v).split(',');
  return [...new Set(arr.map((t) => str(t, 60).trim().toLowerCase()).filter(Boolean))].slice(0, 50);
};
const pairs = (v, a, b) => (Array.isArray(v) ? v : [])
  .map((p) => ({ [a]: str(p && p[a], 300), [b]: str(p && p[b], 2000) }))
  .filter((p) => p[a] || p[b]).slice(0, 50);
const safeUrl = (u) => {
  u = str(u, 2000).trim();
  return /^(https?:|mailto:|tel:|\/|#)/i.test(u) ? u : u ? 'https://' + u : '';
};

function cleanSite(s = {}) {
  return {
    title: str(s.title, 200) || 'Portfolio',
    description: str(s.description, 500),
    colophon: str(s.colophon, 200),
    updated: str(s.updated, 40),
    autoUpdated: s.autoUpdated === undefined ? true : bool(s.autoUpdated),
    footer: pairs(s.footer, 'label', 'url').map((l) => ({ label: l.label, url: safeUrl(l.url) })),
    theme: {
      background: str(s.theme && s.theme.background, 40) || '#ffffff',
      text: str(s.theme && s.theme.text, 40) || '#222222',
      font: str(s.theme && s.theme.font, 300),
    },
  };
}

function cleanProject(p = {}, mediaIds) {
  return {
    id: str(p.id, 40) || id(),
    slug: slugify(p.slug || p.title) || id(),
    title: str(p.title, 300),
    subtitle: str(p.subtitle, 300),
    body: str(p.body, 50000),
    fields: pairs(p.fields, 'label', 'value'),
    links: pairs(p.links, 'label', 'url').map((l) => ({ label: l.label, url: safeUrl(l.url) })),
    tags: tagList(p.tags),
    media: (Array.isArray(p.media) ? p.media : []).map((m) => str(m, 40)).filter((m) => !mediaIds || mediaIds.has(m)),
    layout: ['stack', 'grid', 'wide'].includes(p.layout) ? p.layout : 'stack',
    collapsed: bool(p.collapsed),
    draft: bool(p.draft),
  };
}

function cleanSection(s = {}, mediaIds) {
  const title = str(s.title, 200);
  return {
    id: str(s.id, 40) || id(),
    slug: slugify(s.slug || title) || id(),
    title,
    kind: ['projects', 'tags', 'link', 'label'].includes(s.kind) ? s.kind : 'projects',
    url: s.kind === 'link' ? safeUrl(s.url) : '',
    hidden: bool(s.hidden),
    projects: (Array.isArray(s.projects) ? s.projects : []).map((p) => cleanProject(p, mediaIds)),
  };
}

function cleanMedia(m = {}) {
  return {
    id: str(m.id, 40),
    file: path.basename(str(m.file, 200)),
    type: str(m.type, 20),
    original: str(m.original, 300),
    size: Number(m.size) || 0,
    uploaded: str(m.uploaded, 40),
    title: str(m.title, 300),
    caption: str(m.caption, 5000),
    alt: str(m.alt, 1000),
    credit: str(m.credit, 300),
    tags: tagList(m.tags),
    autoplay: bool(m.autoplay),
  };
}

function uniqueSlugs(list) {
  const seen = new Set();
  for (const item of list) {
    let s = item.slug, n = 2;
    while (seen.has(s)) s = `${item.slug}-${n++}`;
    item.slug = s;
    seen.add(s);
  }
  return list;
}

function normalizeDb(raw = {}) {
  const media = (Array.isArray(raw.media) ? raw.media : []).map(cleanMedia).filter((m) => m.id && m.file);
  const mediaIds = new Set(media.map((m) => m.id));
  const sections = uniqueSlugs((Array.isArray(raw.sections) ? raw.sections : []).map((s) => cleanSection(s, mediaIds)));
  sections.forEach((s) => uniqueSlugs(s.projects));
  return { site: cleanSite(raw.site), sections, media };
}

function touch() {
  if (db.site.autoUpdated) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    db.site.updated = `${pad(d.getMonth() + 1)}.${pad(d.getDate())}.${String(d.getFullYear()).slice(2)}`;
  }
}

db = normalizeDb(JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8')));

/* ---------- public view of the content ---------- */
function publicContent() {
  const sections = db.sections.filter((s) => !s.hidden).map((s) => ({
    ...s,
    projects: s.projects.filter((p) => !p.draft),
  }));
  const used = new Set();
  sections.forEach((s) => s.projects.forEach((p) => p.media.forEach((m) => used.add(m))));
  const media = {};
  db.media.filter((m) => used.has(m.id)).forEach((m) => {
    media[m.id] = { ...m, src: `/uploads/${m.file}` };
  });
  return { site: db.site, sections, media };
}

/* ---------- auth ---------- */
const sessions = new Map(); // token -> expiry ms
const loginAttempts = new Map(); // ip -> {count, until}
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  const t = cookies(req).pb_session;
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function requireAuth(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'Not logged in' });
  // Basic CSRF guard: state-changing admin calls must come from our own JS.
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'portfolio-admin') {
    return res.status(403).json({ error: 'Bad request origin' });
  }
  next();
}
function setCookie(res, token, maxAgeSec) {
  res.setHeader('Set-Cookie', `pb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${SECURE_COOKIE ? '; Secure' : ''}`);
}

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '5mb' }));

app.get('/api/content', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json(publicContent());
});

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const ok = crypto.timingSafeEqual(hash(req.body && req.body.password), hash(ADMIN_PASSWORD));
  if (!ok) {
    a.count += 1;
    if (a.count >= 5) { a.until = Date.now() + 5 * 60 * 1000; a.count = 0; }
    loginAttempts.set(ip, a);
    return res.status(401).json({ error: 'Wrong password' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_HOURS * 3600 * 1000);
  setCookie(res, token, SESSION_HOURS * 3600);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  sessions.delete(cookies(req).pb_session);
  setCookie(res, '', 0);
  res.json({ ok: true });
});

app.get('/api/admin/content', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...db, limits: { maxUploadMb: MAX_UPLOAD_MB, types: TYPES } });
});

// Replace site settings + section/project structure in one go.
app.put('/api/admin/structure', requireAuth, async (req, res) => {
  const mediaIds = new Set(db.media.map((m) => m.id));
  const body = req.body || {};
  db.site = cleanSite(body.site || db.site);
  db.sections = uniqueSlugs((Array.isArray(body.sections) ? body.sections : []).map((s) => cleanSection(s, mediaIds)));
  db.sections.forEach((s) => uniqueSlugs(s.projects));
  touch();
  await save();
  res.json({ site: db.site, sections: db.sections });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now().toString(36)}-${id()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => {
    const ok = typeForExt(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error(`Unsupported file type: ${file.originalname}`), !!ok);
  },
});

app.post('/api/admin/media', requireAuth, (req, res) => {
  upload.array('files')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const tags = tagList(req.body && req.body.tags);
    const added = (req.files || []).map((f) => cleanMedia({
      id: id(),
      file: f.filename,
      type: typeForExt(path.extname(f.filename)),
      original: f.originalname,
      size: f.size,
      uploaded: new Date().toISOString(),
      title: path.basename(f.originalname, path.extname(f.originalname)).replace(/[_-]+/g, ' '),
      tags,
    }));
    db.media.unshift(...added);
    await save();
    res.json(added);
  });
});

app.put('/api/admin/media/:id', requireAuth, async (req, res) => {
  const m = db.media.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const next = cleanMedia({ ...m, ...req.body, id: m.id, file: m.file, type: m.type, original: m.original, size: m.size, uploaded: m.uploaded });
  Object.assign(m, next);
  touch();
  await save();
  res.json(m);
});

app.delete('/api/admin/media/:id', requireAuth, async (req, res) => {
  const i = db.media.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  const [m] = db.media.splice(i, 1);
  db.sections.forEach((s) => s.projects.forEach((p) => { p.media = p.media.filter((x) => x !== m.id); }));
  await save();
  fsp.unlink(path.join(UPLOAD_DIR, m.file)).catch(() => {});
  res.json({ ok: true });
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Portfolio running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (admin: /admin)`);
});
