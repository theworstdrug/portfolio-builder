'use strict';
/*
 * Outgoing email (password resets, test mail, certificate alerts).
 *
 * By default it sends through a mail server on the same machine (Postfix on localhost:25),
 * which is what the IONOS guide sets up. Any SMTP server works:
 *
 *   SMTP_HOST=localhost        set to "off" to disable email entirely
 *   SMTP_PORT=25               587 for STARTTLS submission, 465 for implicit TLS
 *   SMTP_SECURE=false          true only for port 465
 *   SMTP_USER= / SMTP_PASS=    if the server needs a login (e.g. smtp.ionos.com)
 *   MAIL_FROM="Portfolio <noreply@example.com>"   default: noreply@<first DOMAIN>
 *   ADMIN_EMAIL=               fallback recovery address (the client can set her own in the admin)
 */
const nodemailer = require('nodemailer');

function create(env) {
  const host = (env.SMTP_HOST || 'localhost').trim();
  const enabled = host.toLowerCase() !== 'off';
  const port = Number(env.SMTP_PORT || 25);
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  const domain = String(env.DOMAIN || '').split(/[\s,]+/).filter((d) => d && !d.startsWith(':'))[0];
  const from = env.MAIL_FROM || `Portfolio <noreply@${domain || 'localhost'}>`;

  const transport = enabled && nodemailer.createTransport({
    host,
    port,
    secure: env.SMTP_SECURE === 'true' || port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
    // A local Postfix usually has a self-signed ("snakeoil") certificate; that's fine on loopback.
    tls: local ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
  });

  return {
    enabled,
    info: enabled ? `${host}:${port}${env.SMTP_USER ? ` as ${env.SMTP_USER}` : ''}` : 'disabled',
    from,
    async send({ to, subject, text }) {
      if (!enabled) throw new Error('Email is disabled (SMTP_HOST=off)');
      if (!to) throw new Error('No recipient address set');
      return transport.sendMail({ from, to, subject, text });
    },
  };
}

module.exports = { create };
