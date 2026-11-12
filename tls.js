'use strict';
/*
 * HTTPS for the portfolio, without a reverse proxy.
 *
 *   TLS_MODE=off          (default) plain HTTP on PORT (use this behind Caddy/nginx/Cloudflare)
 *   TLS_MODE=letsencrypt  automatic certificates from Let's Encrypt (HTTP-01 challenge)
 *   TLS_MODE=manual       your own certificate files (TLS_CERT + TLS_KEY)
 *
 * Let's Encrypt needs:
 *   DOMAIN=nanarium.com,www.nanarium.com   every name must point (DNS A/AAAA) at this server
 *   LETSENCRYPT_EMAIL=you@example.com      expiry notices from Let's Encrypt
 *   port 80 reachable from the internet    (the challenge always comes in on port 80)
 * Optional:
 *   LETSENCRYPT_STAGING=true               test against the staging CA first (untrusted certs, generous limits)
 *   HTTP_PORT=80  HTTPS_PORT=443
 *
 * Certificates are stored in DATA_DIR/certs and renewed automatically 30 days before expiry,
 * without restarting.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const https = require('https');

const DAY = 24 * 3600 * 1000;
const log = (...a) => console.log('[tls]', ...a);

function config(env, dataDir) {
  return {
    mode: (env.TLS_MODE || 'off').toLowerCase(),
    domains: String(env.DOMAIN || '').split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter((d) => d && !d.startsWith(':')),
    email: env.LETSENCRYPT_EMAIL || '',
    staging: env.LETSENCRYPT_STAGING === 'true',
    httpPort: Number(env.HTTP_PORT || 80),
    httpsPort: Number(env.HTTPS_PORT || 443),
    host: env.HOST || '0.0.0.0',
    certFile: env.TLS_CERT,
    keyFile: env.TLS_KEY,
    dir: path.join(dataDir, 'certs'),
  };
}

/**
 * Start the servers for `app` according to the env. Returns once listening.
 * `plain` is called when TLS is off: (app) => listen however the caller likes.
 */
async function start(app, { env, dataDir, plain, notify = () => {} }) {
  const c = config(env, dataDir);
  if (c.mode === 'off') return plain();
  if (c.mode === 'manual') return startManual(app, c);
  if (c.mode === 'letsencrypt') return startLetsEncrypt(app, c, notify);
  throw new Error(`Unknown TLS_MODE "${c.mode}" (use off, letsencrypt or manual)`);
}

/* ---------------- shared ---------------- */
function redirectHandler(c) {
  return (req, res) => {
    const host = String(req.headers.host || c.domains[0] || '').replace(/:\d+$/, '');
    const port = c.httpsPort === 443 ? '' : `:${c.httpsPort}`;
    res.writeHead(301, { Location: `https://${host}${port}${req.url}` });
    res.end();
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server); });
  });
}

function hsts(app) {
  // Tell browsers to stay on HTTPS for this site (only sent over HTTPS).
  return (req, res) => {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    app(req, res);
  };
}

/* ---------------- manual certificates ---------------- */
async function startManual(app, c) {
  if (!c.certFile || !c.keyFile) throw new Error('TLS_MODE=manual needs TLS_CERT and TLS_KEY (paths to PEM files)');
  const read = () => ({ cert: fs.readFileSync(c.certFile), key: fs.readFileSync(c.keyFile) });
  const server = https.createServer(read(), hsts(app));
  await listen(server, c.httpsPort, c.host);
  await listen(http.createServer(redirectHandler(c)), c.httpPort, c.host);
  log(`HTTPS on :${c.httpsPort} with ${c.certFile}; HTTP :${c.httpPort} redirects`);
  // pick up renewed files (e.g. from certbot) without a restart
  let t;
  fs.watchFile(c.certFile, { interval: 60000 }, () => {
    clearTimeout(t);
    t = setTimeout(() => { try { server.setSecureContext(read()); log('reloaded certificate'); } catch (e) { log('reload failed:', e.message); } }, 2000);
  });
}

/* ---------------- Let's Encrypt ---------------- */
async function startLetsEncrypt(app, c, notify) {
  if (!c.domains.length) throw new Error('TLS_MODE=letsencrypt needs DOMAIN (e.g. DOMAIN=example.com,www.example.com)');
  if (!c.email) throw new Error('TLS_MODE=letsencrypt needs LETSENCRYPT_EMAIL');
  const acme = require('acme-client');
  await fsp.mkdir(c.dir, { recursive: true, mode: 0o700 });

  const files = {
    account: path.join(c.dir, `account${c.staging ? '-staging' : ''}.key`),
    key: path.join(c.dir, `${c.staging ? 'staging-' : ''}privkey.pem`),
    cert: path.join(c.dir, `${c.staging ? 'staging-' : ''}fullchain.pem`),
  };
  const challenges = new Map(); // token -> key authorization
  let httpsServer = null;

  // Port 80: ACME challenges; otherwise redirect to HTTPS once we have a certificate,
  // and serve the site over plain HTTP until then so it's never down.
  const toHttps = redirectHandler(c);
  const httpServer = http.createServer((req, res) => {
    const m = req.url.match(/^\/\.well-known\/acme-challenge\/([\w-]+)$/);
    if (m) {
      const answer = challenges.get(m[1]);
      res.writeHead(answer ? 200 : 404, { 'Content-Type': 'text/plain' });
      return res.end(answer || 'not found');
    }
    return httpsServer ? toHttps(req, res) : app(req, res);
  });
  await listen(httpServer, c.httpPort, c.host);
  log(`HTTP on :${c.httpPort} (ACME challenges + redirect)`);

  const readExisting = async () => {
    try {
      const [key, cert] = await Promise.all([fsp.readFile(files.key), fsp.readFile(files.cert)]);
      const info = acme.crypto.readCertificateInfo(cert);
      const names = new Set([info.domains.commonName, ...(info.domains.altNames || [])].filter(Boolean).map((d) => d.toLowerCase()));
      return { key, cert, notAfter: new Date(info.notAfter), covers: c.domains.every((d) => names.has(d)) };
    } catch { return null; }
  };

  const issue = async () => {
    log(`requesting certificate for ${c.domains.join(', ')}${c.staging ? ' (STAGING)' : ''}…`);
    let accountKey;
    try { accountKey = await fsp.readFile(files.account); } catch {
      accountKey = await acme.crypto.createPrivateKey();
      await fsp.writeFile(files.account, accountKey, { mode: 0o600 });
    }
    const client = new acme.Client({
      directoryUrl: c.staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
      accountKey,
    });
    const [key, csr] = await acme.crypto.createCsr({ commonName: c.domains[0], altNames: c.domains });
    const cert = await client.auto({
      csr,
      email: c.email,
      termsOfServiceAgreed: true,
      challengePriority: ['http-01'],
      challengeCreateFn: async (authz, challenge, keyAuthorization) => { challenges.set(challenge.token, keyAuthorization); },
      challengeRemoveFn: async (authz, challenge) => { challenges.delete(challenge.token); },
    });
    await fsp.writeFile(files.key, key, { mode: 0o600 });
    await fsp.writeFile(files.cert, cert);
    log('certificate saved to', c.dir);
    return readExisting();
  };

  const apply = async (cur) => {
    if (!httpsServer) {
      httpsServer = https.createServer({ key: cur.key, cert: cur.cert }, hsts(app));
      await listen(httpsServer, c.httpsPort, c.host);
      log(`HTTPS on :${c.httpsPort}, certificate valid until ${cur.notAfter.toISOString().slice(0, 10)}`);
    } else {
      httpsServer.setSecureContext({ key: cur.key, cert: cur.cert });
      log(`certificate renewed, valid until ${cur.notAfter.toISOString().slice(0, 10)}`);
    }
  };

  // check now, then twice a day; retry sooner after a failure
  let failures = 0, lastAlert = 0;
  const check = async () => {
    let next = DAY / 2;
    try {
      let cur = await readExisting();
      const due = !cur || !cur.covers || cur.notAfter - Date.now() < 30 * DAY;
      if (due) cur = await issue();
      if (cur && (due || !httpsServer)) await apply(cur);
      failures = 0;
    } catch (e) {
      failures++;
      next = Math.min(DAY / 2, 15 * 60 * 1000 * 2 ** (failures - 1)); // 15m, 30m, 1h… max 12h
      log(`certificate request failed: ${e.message}`);
      log(`  check that DNS for ${c.domains.join(', ')} points here and port ${c.httpPort} is open. Retrying in ${Math.round(next / 60000)} min.`);
      const cur = await readExisting();
      if (cur && cur.notAfter > Date.now()) await apply(cur).catch(() => {}); // keep serving the old one
      // email the owner if this is becoming a real problem (at most once a day)
      const urgent = cur ? cur.notAfter - Date.now() < 14 * DAY : failures >= 3;
      if (urgent && Date.now() - lastAlert > DAY) {
        lastAlert = Date.now();
        notify(`HTTPS certificate problem on ${c.domains[0]}`,
          `The site could not get or renew its HTTPS certificate.\n\nError: ${e.message}\n\n`
          + (cur ? `The current certificate expires ${cur.notAfter.toISOString().slice(0, 10)}.` : 'There is no certificate yet, so the site is only on plain HTTP.')
          + `\n\nUsually this means the domain's DNS no longer points at the server, or port ${c.httpPort} is blocked. It will keep retrying.`);
      }
    }
    setTimeout(check, next).unref();
  };
  await check();
}

module.exports = { start, config };
