# Shiorra — Full-stack storefront + admin

A production-ready Node app for the Shiorra brand:

- **Storefront** — home, shop, product detail, cart, checkout
- **Auth** — email + password, session-backed, bcrypt-hashed
- **Cart** — works for guests (session) and logged-in users (DB), auto-merged on login
- **Payments** — Razorpay Checkout with webhook verification
- **Admin** — dashboard, product CRUD with image upload, order list + status, user management
- **VPS-friendly** — plain Node + PostgreSQL, runs anywhere; no Vercel / Edge / serverless lock-in

Stack: **Express · EJS · Prisma · PostgreSQL · Passport (local) · bcryptjs · Razorpay · Multer**

---

## Local development

### 1. Install Node + Postgres

You need Node 18+ and a running Postgres instance.

```bash
# macOS
brew install node postgresql@16
brew services start postgresql@16
createdb shiorra
```

### 2. Install dependencies

```bash
cd app
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and SESSION_SECRET.
# Razorpay keys can be left as placeholders until you wire payments.
```

### 4. Initialise the database

```bash
npx prisma migrate dev --name init
npm run seed
```

The seed inserts the four Shiorra products (Iron+, Ginger+, Calcium+, Multivitamin+) and creates an admin user. Credentials come from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` (default `admin@shiorra.com` / `ChangeMeNow!2026`).

### 5. Run the dev server

```bash
npm run dev
```

Visit:

- Storefront: <http://localhost:3000>
- Admin: <http://localhost:3000/admin> (log in with the admin credentials above)
- Prisma Studio (DB viewer): `npm run prisma:studio`

---

## Deploying to a VPS (Ubuntu 22.04 example)

### 1. Server prep

```bash
# As root
apt update && apt upgrade -y
apt install -y curl git nginx ufw

# Node 20 (LTS) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Postgres 16
apt install -y postgresql postgresql-contrib

# PM2 process manager
npm install -g pm2

# UFW firewall
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw enable
```

### 2. Create the Postgres database

```bash
sudo -u postgres psql <<EOF
CREATE USER shiorra WITH PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE shiorra OWNER shiorra;
GRANT ALL PRIVILEGES ON DATABASE shiorra TO shiorra;
EOF
```

### 3. Pull the code

```bash
# As a non-root user (e.g. `deploy`)
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
su - deploy

mkdir -p ~/sites && cd ~/sites
git clone https://github.com/your-org/Shiorra.git
cd Shiorra/app
npm ci
```

### 4. Configure environment

```bash
cp .env.example .env
nano .env
```

Set:

```env
NODE_ENV=production
APP_URL=https://shiorra.com
DATABASE_URL=postgresql://shiorra:CHANGE_ME_STRONG@localhost:5432/shiorra?schema=public
SESSION_SECRET=...                           # 64+ random chars
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
ADMIN_EMAIL=you@shiorra.com
ADMIN_PASSWORD=Strong-One-Time-Password
```

### 5. Migrate and seed

```bash
npx prisma migrate deploy
npm run seed
```

### 6. Start with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd     # follow the printed command to auto-start on boot
```

Quick verify:

```bash
curl -I http://127.0.0.1:3000
# HTTP/1.1 200 OK
```

### 7. Nginx reverse proxy + HTTPS

Create `/etc/nginx/sites-available/shiorra`:

```nginx
server {
    listen 80;
    server_name shiorra.com www.shiorra.com;

    client_max_body_size 16M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable + reload:

```bash
ln -s /etc/nginx/sites-available/shiorra /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Add HTTPS with Let's Encrypt:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d shiorra.com -d www.shiorra.com
# Certbot will edit your Nginx config and set up auto-renewal.
```

### 8. Razorpay webhook

In the Razorpay dashboard → Settings → Webhooks → Add:

- URL: `https://shiorra.com/checkout/webhook`
- Active events: `payment.captured`, `payment.authorized`, `payment.failed`
- Secret: copy into `RAZORPAY_WEBHOOK_SECRET` in `.env`, then `pm2 restart shiorra-app`.

### 9. Updates

```bash
cd ~/sites/Shiorra
git pull
cd app
npm ci
npx prisma migrate deploy
pm2 reload shiorra-app
```

---

## Project layout

```
app/
├── package.json
├── ecosystem.config.js          # PM2 process definition
├── prisma/
│   ├── schema.prisma            # DB models
│   └── seed.js                  # Seeds products + admin user
└── src/
    ├── server.js                # Boot + graceful shutdown
    ├── app.js                   # Express wiring
    ├── config/                  # env, db, passport, razorpay
    ├── middleware/              # auth, flash, locals, error handler
    ├── routes/                  # storefront, auth, account, cart, checkout, admin, api
    ├── controllers/             # request handlers
    ├── utils/                   # money, orderNumber
    ├── views/                   # EJS templates
    │   ├── layouts/main.ejs
    │   ├── partials/            # header, footer, flash, product-card
    │   ├── pages/               # storefront pages
    │   ├── auth/                # login, register
    │   └── admin/               # dashboard, products, orders, users
    └── public/                  # static assets (CSS, JS, images, uploads)
```

## Money handling

All prices are stored as **integer paise** (`priceInPaise`, `totalInPaise`, etc.) to avoid floating-point drift. UI conversion lives in `src/utils/money.js` (`toPaise`, `fromPaise`, `formatINR`).

## Adding a product

`/admin/products/new` — supports multiple images (Multer disk storage to `src/public/uploads/`), slug uniqueness, pricing, MRP, stock, featured/active toggles, ingredients, serving info, SEO.

## Order lifecycle

```
PENDING → PAID → PROCESSING → SHIPPED → DELIVERED
                          ↘ CANCELLED / REFUNDED
```

Payments are confirmed via Razorpay webhook (`/checkout/webhook`) using HMAC-SHA256 of the raw request body. Events are deduplicated in the `PaymentEvent` table so retries from Razorpay are idempotent.

## Security defaults

- bcrypt password hashing (cost 12)
- Helmet with sensible CSP in production
- HttpOnly + SameSite=lax session cookies
- Postgres-backed session store in production (Memorystore in dev)
- Rate limit on `/login` and `/register` (20 attempts per 10 min)
- Global rate limit (240 req/min/IP)
- `trust proxy = 1` so secure cookies work behind Nginx

## License

Proprietary — Shiorra / K.C. Laboratories.
