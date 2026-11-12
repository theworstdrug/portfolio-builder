# Setting up an IONOS server

This guide takes a fresh IONOS VPS to live HTTPS sites. It assumes:

- the domains are registered at **Namecheap**, and only the server is at IONOS;

- you manage it over **SSH**, move files with **SFTP**, and use a **remote desktop** from a Linux machine;
- the server will host **several sites**. The examples use `nanarium.space` and `prismarose.space`, and the server itself is named `srv1.prismarose.space`.

Lines starting with `local$` run on your computer, and `server$` lines run on the server over SSH. Replace `SERVER_IP` with the server's address.

> Only hosting a single site? You can skip Caddy (step 8) and let the app handle HTTPS itself. Use `TLS_MODE=letsencrypt` with `deploy/portfolio.service`, as described in the README. The setup below scales to more sites without changes.

**Contents**

1. [Choose the server](#1-choose-the-server)
2. [First login and a non-root user](#2-first-login-and-a-non-root-user)
3. [Firewalls](#3-firewalls)
4. [DNS (Namecheap)](#4-dns-domains-at-namecheap)
5. [Install Node, Caddy and Postfix](#5-install-node-caddy-and-postfix)
6. [Upload a site (SFTP)](#6-upload-a-site-sftp)
7. [Configure and start the site](#7-configure-and-start-the-site)
8. [HTTPS for every site (Caddy)](#8-https-for-every-site-caddy)
9. [Email (Postfix, send-only)](#9-email-postfix-send-only)
10. [Remote desktop](#10-remote-desktop)
11. [Adding another site](#11-adding-another-site)
12. [Updates, backups, recovery](#12-updates-backups-recovery)

---

## 1. Choose the server

- **Plan:** you need an IONOS **VPS** or **Cloud Server**. Their "Web Hosting" plans can't run Node or give you root access.
- **Size:** get **2 GB RAM** or more if you want the remote desktop. The sites alone are happy with 1 GB.
- **Image:** choose **Ubuntu 24.04**.
- **Release bundle:** download `portfolio-vX.Y.Z.tar.gz` from the repo's **Releases** page to your computer. (Releases are made by pushing a tag like `v1.0.0`; see the README.)

## 2. First login and a non-root user

The IONOS Cloud Panel shows the server's **IP address** and **initial root password**.

```bash
local$  ssh-keygen -t ed25519            # skip if ~/.ssh/id_ed25519 already exists
local$  ssh root@SERVER_IP               # initial password from the panel

server$ apt update && apt full-upgrade -y
server$ hostnamectl set-hostname srv1.prismarose.space
server$ adduser deploy                   # choose a password: used for sudo and remote desktop
server$ usermod -aG sudo deploy
server$ exit

local$  ssh-copy-id deploy@SERVER_IP
local$  ssh deploy@SERVER_IP             # logs in with your key
```

Next, disable root logins and password logins over SSH. **Keep this session open and test a new login from a second terminal before closing it.**

```bash
server$ sudo tee /etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
EOF
server$ sudo systemctl restart ssh
```

Optional: add a shortcut to `~/.ssh/config` on your computer so you can just type `ssh srv1`:
```
Host srv1
    HostName SERVER_IP
    User deploy
```

## 3. Firewalls

There are two firewalls, and both need these ports open.

**IONOS Cloud Panel → Network → Firewall Policies** (the policy attached to the server): allow TCP **22, 80, 443**. Leave everything else closed. In particular, **don't** open 3389, because the remote desktop goes through SSH (step 10).

On the server:
```bash
server$ sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
server$ sudo ufw enable
```

## 4. DNS (domains at Namecheap)

The domains stay registered at Namecheap. You only point them at the IONOS server. In Namecheap, go to **Domain List → Manage** (next to the domain) → **Advanced DNS**.

First check the **Domain** tab: under **Nameservers** it should say **Namecheap BasicDNS**. If it says Custom DNS, the records below must be made wherever those nameservers live instead.

**prismarose.space** (your domain, which also names the server):

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `srv1` | SERVER_IP | Automatic |
| A Record | `@` | SERVER_IP | Automatic |
| A Record | `www` | SERVER_IP | Automatic |

**nanarium.space** (the client's domain):

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `@` | SERVER_IP | Automatic |
| A Record | `www` | SERVER_IP | Automatic |

New Namecheap domains come with two placeholder records. **Delete both** on each domain, or they'll fight with the A records above:

- **CNAME Record** `www` → `parkingpage.namecheap.com.`
- **URL Redirect Record** `@` → `http://www.<domain>`

Also:

- **Delete any AAAA records** on `@` and `www`, unless they hold the server's own IPv6 address. Let's Encrypt prefers IPv6 and fails if one points elsewhere.
- **Leave the "Mail Settings" section alone** (at the bottom of Advanced DNS: Email Forwarding, Private Email, Custom MX…). That decides where the domain's *incoming* mail goes, and this server doesn't change it (see step 9).

**Reverse DNS stays at IONOS.** It belongs to whoever owns the IP, not the domain. In the IONOS Cloud Panel, under the server's IP address, set reverse DNS (PTR) to `srv1.prismarose.space`. Do this *after* the `srv1` A record above exists. Mail providers check that the two match.

Namecheap changes usually show up within minutes, though they can take up to an hour. Check from your computer. The first command should print your IP and the second nothing:
```bash
local$ dig +short nanarium.space A ; dig +short nanarium.space AAAA
local$ dig +short srv1.prismarose.space A
local$ dig +short -x SERVER_IP          # → srv1.prismarose.space.
```

## 5. Install Node, Caddy and Postfix

```bash
server$ curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
server$ sudo apt install -y nodejs caddy postfix
```

Postfix asks two questions:

- **General type of mail configuration:** `Internet Site`
- **System mail name:** `srv1.prismarose.space`

Step 9 finishes the Postfix setup.

## 6. Upload a site (SFTP)

Each site gets its own folder under `/opt`, owned by `deploy` so you can upload into it:

```bash
server$ sudo mkdir -p /opt/nanarium && sudo chown deploy: /opt/nanarium
```

Copy `portfolio-vX.Y.Z.tar.gz` to `/opt/nanarium`. Use SFTP rather than FTP: it reuses your SSH login and key, and there's no FTP server to install or secure.

- **FileZilla:** Site Manager → protocol **SFTP**, host SERVER_IP, port 22, user `deploy`, logon type **Key file** → `~/.ssh/id_ed25519`.
- **File manager** (Nautilus/Dolphin/Thunar): address bar → `sftp://deploy@SERVER_IP/opt/nanarium`.
- **Terminal:** `local$ scp portfolio-vX.Y.Z.tar.gz deploy@SERVER_IP:/opt/nanarium/`

Unpack:
```bash
server$ cd /opt/nanarium && tar xzf portfolio-v*.tar.gz --strip-components=1 && rm portfolio-v*.tar.gz
```

## 7. Configure and start the site

```bash
server$ cp .env.example .env && chmod 600 .env && nano .env
```

You can also open `.env` over SFTP and edit it on your computer. With Caddy in front, each site runs plain HTTP on its **own local port**:

```ini
TLS_MODE=off
PORT=3001                              # unique per site: 3001, 3002, …
DOMAIN=nanarium.space,www.nanarium.space   # used for links in emails
SMTP_HOST=localhost
SMTP_PORT=25
MAIL_FROM=Nanarium <noreply@nanarium.space>
ADMIN_PASSWORD=a-long-temporary-password
```

Start it with the multi-site systemd template:
```bash
server$ sudo mkdir -p /opt/nanarium/data && sudo chown -R www-data: /opt/nanarium/data
server$ sudo cp deploy/portfolio@.service /etc/systemd/system/
server$ sudo systemctl daemon-reload && sudo systemctl enable --now portfolio@nanarium
server$ journalctl -u portfolio@nanarium -f      # "Portfolio running at …:3001"
```

## 8. HTTPS for every site (Caddy)

Caddy gets and renews a Let's Encrypt certificate for each domain and forwards visitors to the right site. Put this in `/etc/caddy/Caddyfile`:

```
{
	email you@prismarose.space
}

nanarium.space, www.nanarium.space {
	encode zstd gzip
	request_body {
		max_size 1GB
	}
	reverse_proxy 127.0.0.1:3001
}

# prismarose.space, www.prismarose.space {
# 	encode zstd gzip
# 	reverse_proxy 127.0.0.1:3002
# }
```

```bash
server$ sudo systemctl reload caddy
server$ journalctl -u caddy -f          # watch for "certificate obtained successfully"
```

Open `https://nanarium.space/admin`, log in with the temporary password, then:

1. **Site → Password & backup:** have the client choose her own password. From then on hers is the one that counts, and the one in `.env` is ignored.
2. In the same section, set her **recovery email** and press **Send test email**. This needs step 9 first.

## 9. Email (Postfix, send-only)

The sites send a little mail: "Forgot password?" links, and alerts if a certificate can't renew. Postfix sends it out. Set it up as **send-only**, so it relays the apps' mail to the internet and receives nothing:

```bash
server$ sudo postconf -e \
    'myhostname = srv1.prismarose.space' \
    'myorigin = /etc/mailname' \
    'inet_interfaces = loopback-only' \
    'inet_protocols = ipv4' \
    'mydestination = localhost'
server$ echo srv1.prismarose.space | sudo tee /etc/mailname
server$ sudo systemctl restart postfix
```

What each setting does:

- `myhostname`: the name the server introduces itself with. It matches the reverse DNS from step 4. **Don't use the bare IP**, because receivers reject or spam-flag that.
- `inet_interfaces = loopback-only`: only programs on this server can send. Nothing from outside can use it as a relay.
- `inet_protocols = ipv4`: only IPv4 has reverse DNS set up, and Gmail rejects IPv6 senders without it.
- `mydestination = localhost`: **never list the sites' domains here.** If you did, a reset email to her@nanarium.space would be "delivered" on this server instead of reaching her real mailbox.

**Webmail is unaffected.** Incoming mail for nanarium.space follows its MX records (Namecheap's "Mail Settings"), so she keeps reading it wherever she does now. This server only sends.

**SPF: allow this server to send for each domain.** In Namecheap, Advanced DNS → **TXT Record**, host `@`. A domain can have only **one** SPF record (`v=spf1 …`), so if there's already one, edit it rather than adding a second.

| The domain's mail setting | SPF value |
|---|---|
| No email service | `v=spf1 ip4:SERVER_IP ~all` |
| Namecheap Email Forwarding | `v=spf1 include:spf.efwd.registrar-servers.com ip4:SERVER_IP ~all` |
| Namecheap Private Email | `v=spf1 include:spf.privateemail.com ip4:SERVER_IP ~all` |
| Something else (Google, Zoho, …) | keep that provider's `include:` and add ` ip4:SERVER_IP` before `~all` |

Namecheap often adds the include for you when you turn on a mail service. If there's already an SPF record, just insert `ip4:SERVER_IP` into it.

**Test it:** press **Send test email** in the admin. If you want to watch it go out:
```bash
server$ sudo journalctl -f | grep postfix
```
You're looking for `status=sent`. For a deliverability score, send the test to the address shown on mail-tester.com.

**If you see `Connection timed out` to port 25:** the provider is blocking outgoing port 25, which some do on new accounts. Either ask IONOS support to unblock it, or send through an IONOS mailbox instead. In the site's `.env`:

```ini
SMTP_HOST=smtp.ionos.com
SMTP_PORT=587
SMTP_USER=noreply@nanarium.space      # a real IONOS mailbox on that site's domain
SMTP_PASS=the-mailbox-password
MAIL_FROM=Nanarium <noreply@nanarium.space>
```

Then `sudo systemctl restart portfolio@nanarium`. IONOS only lets a mailbox send as its own domain, so each site needs its own mailbox if you go this way. (If the client's mail is Namecheap Private Email, its SMTP works the same way: `SMTP_HOST=mail.privateemail.com`, `SMTP_PORT=587`, with that mailbox's login.)

## 10. Remote desktop

This installs a light desktop and an RDP server that **only listens on the server itself**. You reach it through an SSH tunnel, so nothing is exposed to the internet.

```bash
server$ sudo apt install -y xfce4 xfce4-goodies xrdp
server$ sudo adduser xrdp ssl-cert
server$ echo xfce4-session > ~/.xsession
server$ sudo sed -i 's/^port=3389/port=tcp:\/\/127.0.0.1:3389/' /etc/xrdp/xrdp.ini
server$ sudo systemctl restart xrdp
server$ sudo ss -ltnp | grep 3389      # should show 127.0.0.1:3389
```

Connect from your computer:
```bash
local$ ssh -N -L 13389:127.0.0.1:3389 deploy@SERVER_IP
```

Leave that running. In **Remmina**, create a new connection: protocol **RDP**, server `localhost:13389`, user `deploy`, and the password from step 2.

If `ss` shows `0.0.0.0:3389` instead, your xrdp version ignored the address. It's still safe as long as 3389 stays closed in both firewalls (step 3).

## 11. Adding another site

For example, prismarose.space:

1. **DNS:** A records for `@` and `www` (step 4), and its SPF record (step 9).
2. **Folder:**
   ```bash
   server$ sudo mkdir -p /opt/prismarose && sudo chown deploy: /opt/prismarose
   ```
   Then upload and unpack the release into it (step 6).
3. **`.env`:** as in step 7, with **`PORT=3002`**, its own `DOMAIN`, `MAIL_FROM` and password.
4. **Start it:**
   ```bash
   server$ sudo mkdir -p /opt/prismarose/data && sudo chown -R www-data: /opt/prismarose/data
   server$ sudo systemctl enable --now portfolio@prismarose
   ```
5. **Caddy:** add a block for the domain pointing at `127.0.0.1:3002`, then `sudo systemctl reload caddy`.

Sites are completely separate. Each has its own content, uploads, password and admin.

## 12. Updates, backups, recovery

**Updating a site to a new release:** upload the new tarball over SFTP, then:
```bash
server$ cd /opt/nanarium && tar xzf portfolio-v*.tar.gz --strip-components=1 && rm portfolio-v*.tar.gz
server$ sudo systemctl restart portfolio@nanarium
```
Unpacking never touches `data/` or `.env`.

**Backups:** turn on IONOS server snapshots in the Cloud Panel, and/or pull a copy:
```bash
local$ ssh deploy@SERVER_IP "sudo tar czf - -C /opt/nanarium data .env" > nanarium-backup-$(date +%F).tgz
```

**Client forgot her password:**

- If her recovery email is set, she can press **Forgot password?** on the login page.
- Otherwise, reset to the `.env` password:
  ```bash
  server$ sudo rm /opt/nanarium/data/auth.json && sudo systemctl restart portfolio@nanarium
  ```
  This also clears the recovery email, so set it again afterwards.

**Something's wrong:**

| Symptom | Check |
|---|---|
| Site down | `systemctl status portfolio@nanarium`, `journalctl -u portfolio@nanarium -n 50` |
| Certificate errors | `journalctl -u caddy -n 50`. Usually DNS (Namecheap's leftover URL redirect or AAAA records!) or a closed port 80. |
| Emails not arriving | `sudo journalctl -t postfix/smtp -n 50`, then check SPF, reverse DNS, and the spam folder. |
| Uploads fail on big videos | Raise `MAX_UPLOAD_MB` in `.env` **and** `max_size` in the Caddyfile. |
