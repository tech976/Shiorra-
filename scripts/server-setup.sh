#!/usr/bin/env bash
# ============================================================================
# Shiōrra — one-time VPS bootstrap script
#
# Run THIS ON THE VPS (the new Shiōrra VPS — NOT the CRM at 147.93.107.46)
# as root, ONCE, on a fresh Ubuntu 22.04 box. Installs Node 20 LTS,
# Postgres 16, Nginx, PM2, certbot, ufw. Creates the `deploy` user, clones
# the Shiōrra repo to /opt/shiorra, sets up the database, prepares for the
# first deploy.
#
# After this, ssh from your Mac stays open via the `deploy` user, and
# day-to-day deploys are run from your Mac with ./deploy.sh — this script
# is NEVER needed again.
#
# This script:
#   • NEVER touches /opt/crm
#   • NEVER touches a PM2 process named "crm"
#   • NEVER clones tech976/CRM-
#   • Only installs into /opt/shiorra
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# HARDCODED — Shiōrra-only. Edit ONLY if you intentionally moved something.
# ---------------------------------------------------------------------------
APP_PATH="/opt/shiorra"
APP_SUBDIR="app"
PM2_NAME="shiorra-app"
DEPLOY_USER="deploy"
REPO_URL="https://github.com/tech976/Shiorra-.git"
BRANCH="main"
DB_NAME="shiorra"
DB_USER="shiorra"
APP_PORT=3000
DOMAIN=""                          # set to e.g. shiorra.com to enable SSL via certbot, leave "" to skip
NODE_MAJOR=20

# ---------------------------------------------------------------------------
# Safety guards
# ---------------------------------------------------------------------------
if [[ "$APP_PATH" == "/opt/crm" ]] || [[ "$PM2_NAME" == "crm" ]] || [[ "$REPO_URL" == *"CRM-"* ]]; then
  echo "✖ ABORT: this script's target collides with the CRM project." >&2
  exit 2
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "✖ This bootstrap must run as root. Try: sudo bash $0" >&2
  exit 1
fi

echo "════════════════════════════════════════════════════════════════"
echo "  Shiōrra VPS bootstrap"
echo "    Host:       $(hostname) ($(curl -s ifconfig.me || echo unknown))"
echo "    Path:       ${APP_PATH}/${APP_SUBDIR}"
echo "    PM2 proc:   ${PM2_NAME}"
echo "    Deploy usr: ${DEPLOY_USER}"
echo "    DB:         ${DB_NAME} owned by ${DB_USER}"
echo "    Node:       v${NODE_MAJOR} LTS"
echo "    Domain:     ${DOMAIN:-(no domain — SSL skipped)}"
echo "════════════════════════════════════════════════════════════════"
read -r -p "Proceed? [y/N] " confirm
if [[ "${confirm,,}" != "y" && "${confirm,,}" != "yes" ]]; then
  echo "Aborted."; exit 0
fi

# ---------------------------------------------------------------------------
# 1) System packages
# ---------------------------------------------------------------------------
echo "▸ apt update + upgrade …"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git nginx ufw build-essential ca-certificates gnupg

# ---------------------------------------------------------------------------
# 2) Node.js 20 LTS via NodeSource
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//;s/\..*//')" != "$NODE_MAJOR" ]]; then
  echo "▸ Installing Node ${NODE_MAJOR} LTS …"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
echo "▸ Node $(node -v) · npm $(npm -v)"

# ---------------------------------------------------------------------------
# 3) PostgreSQL 16
# ---------------------------------------------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  echo "▸ Installing PostgreSQL 16 …"
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
  apt-get update -y
  apt-get install -y postgresql-16
  systemctl enable --now postgresql
fi

# ---------------------------------------------------------------------------
# 4) Create database + db user (idempotent)
# ---------------------------------------------------------------------------
DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"

echo "▸ Configuring Postgres user ${DB_USER} + database ${DB_NAME} …"
sudo -u postgres psql <<SQL || true
DO \$\$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
   END IF;
END
\$\$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

# ---------------------------------------------------------------------------
# 5) Deploy user (no sudo; sudo only for PM2 startup)
# ---------------------------------------------------------------------------
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  echo "▸ Creating user ${DEPLOY_USER} …"
  useradd -m -s /bin/bash "${DEPLOY_USER}"
  install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
  chmod 700 "/home/${DEPLOY_USER}/.ssh"
  if [[ -f /root/.ssh/authorized_keys ]]; then
    cp /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    echo "  → copied root's authorized_keys to ${DEPLOY_USER}"
  else
    echo "  ⚠ root has no authorized_keys — paste your Mac's public key into /home/${DEPLOY_USER}/.ssh/authorized_keys manually."
  fi
fi

# ---------------------------------------------------------------------------
# 6) Clone repo to /opt/shiorra (deploy user owns it)
# ---------------------------------------------------------------------------
if [[ ! -d "${APP_PATH}/.git" ]]; then
  echo "▸ Cloning ${REPO_URL} → ${APP_PATH} …"
  install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_PATH}"
  sudo -u "${DEPLOY_USER}" git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_PATH}"
fi
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_PATH}"

# ---------------------------------------------------------------------------
# 7) Seed app/.env (uses generated DB password)
# ---------------------------------------------------------------------------
ENV_FILE="${APP_PATH}/${APP_SUBDIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "▸ Creating ${ENV_FILE} …"
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '/+=')"
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=${APP_PORT}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public
SESSION_SECRET=${SESSION_SECRET}
APP_URL=${DOMAIN:+https://}${DOMAIN:-http://$(curl -s ifconfig.me)}
# RAZORPAY_KEY_ID=
# RAZORPAY_KEY_SECRET=
# RAZORPAY_WEBHOOK_SECRET=
ENV
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "  → DB password saved in $ENV_FILE (chmod 600). Copy it somewhere safe."
fi

# ---------------------------------------------------------------------------
# 8) PM2 (global, deploy user runs it)
# ---------------------------------------------------------------------------
echo "▸ Installing PM2 …"
npm install -g pm2 >/dev/null

# ---------------------------------------------------------------------------
# 9) Install app deps + run migrations + start
# ---------------------------------------------------------------------------
echo "▸ npm ci (production) …"
sudo -u "${DEPLOY_USER}" bash -c "cd '${APP_PATH}/${APP_SUBDIR}' && npm ci --omit=dev"
echo "▸ prisma generate + migrate deploy …"
sudo -u "${DEPLOY_USER}" bash -c "cd '${APP_PATH}/${APP_SUBDIR}' && npx --yes prisma generate && npx --yes prisma migrate deploy"

if ! sudo -u "${DEPLOY_USER}" pm2 list | grep -q "${PM2_NAME}"; then
  echo "▸ pm2 start ${PM2_NAME} …"
  sudo -u "${DEPLOY_USER}" bash -c "cd '${APP_PATH}/${APP_SUBDIR}' && pm2 start ecosystem.config.js --env production --name '${PM2_NAME}'"
fi
sudo -u "${DEPLOY_USER}" pm2 save

# pm2 startup must run as root
PM2_STARTUP_CMD=$(sudo -u "${DEPLOY_USER}" pm2 startup systemd -u "${DEPLOY_USER}" --hp "/home/${DEPLOY_USER}" | tail -n 1)
eval "$PM2_STARTUP_CMD" || true

# ---------------------------------------------------------------------------
# 10) Nginx — reverse-proxy / → 127.0.0.1:${APP_PORT}
# ---------------------------------------------------------------------------
NGINX_CONF="/etc/nginx/sites-available/shiorra"
SERVER_NAME="${DOMAIN:-_}"
cat > "$NGINX_CONF" <<NGINX
server {
    listen 80;
    server_name ${SERVER_NAME};

    # Long-cache the heavy assets (scroll-seq frames + images)
    location ~* ^/(frames|img|css|js)/.*\.(jpg|jpeg|png|svg|webp|woff2?|css|js)$ {
        root ${APP_PATH}/${APP_SUBDIR}/src/public;
        expires 30d;
        access_log off;
        add_header Cache-Control "public, immutable";
        try_files \$uri @app;
    }
    location @app {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    client_max_body_size 12m;
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
}
NGINX

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/shiorra
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ---------------------------------------------------------------------------
# 11) Firewall (only 22, 80, 443)
# ---------------------------------------------------------------------------
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ---------------------------------------------------------------------------
# 12) Optional: SSL via Let's Encrypt (only if domain set + resolves)
# ---------------------------------------------------------------------------
if [[ -n "$DOMAIN" ]]; then
  apt-get install -y certbot python3-certbot-nginx
  echo "▸ Requesting SSL for ${DOMAIN} (make sure DNS A-record points at this VPS) …"
  certbot --nginx --non-interactive --agree-tos --redirect -m "admin@${DOMAIN}" -d "${DOMAIN}" || \
    echo "  ⚠ certbot failed — check DNS and re-run: certbot --nginx -d ${DOMAIN}"
fi

# ---------------------------------------------------------------------------
# 13) Print summary
# ---------------------------------------------------------------------------
PUBLIC_IP="$(curl -s ifconfig.me || echo unknown)"
echo "════════════════════════════════════════════════════════════════"
echo "  ✓ Shiōrra VPS bootstrap complete"
echo ""
echo "  Visit:        http://${PUBLIC_IP}${DOMAIN:+  ·  https://${DOMAIN}}"
echo "  App:          ${APP_PATH}/${APP_SUBDIR}  (owned by ${DEPLOY_USER})"
echo "  PM2:          sudo -u ${DEPLOY_USER} pm2 list"
echo "  Logs:         sudo -u ${DEPLOY_USER} pm2 logs ${PM2_NAME}"
echo "  Restart:      sudo -u ${DEPLOY_USER} pm2 reload ${PM2_NAME}"
echo "  DB password:  see ${APP_PATH}/${APP_SUBDIR}/.env  (DATABASE_URL line)"
echo ""
echo "  Next on your Mac:"
echo "    1) Edit deploy.sh and set HOST=${PUBLIC_IP}"
echo "    2) ./deploy.sh --dry-run     (confirm target)"
echo "    3) ./deploy.sh               (real deploy)"
echo "════════════════════════════════════════════════════════════════"
