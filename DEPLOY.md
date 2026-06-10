# Shiōrra deploy pipeline

Self-contained deploy for **the Shiōrra project only**. Every target is
hardcoded in [`deploy.sh`](deploy.sh) and [`scripts/server-setup.sh`](scripts/server-setup.sh)
— the scripts cannot reach the user's separate CRM project even if env vars
or hostnames overlap.

## Isolation guarantees

| Concern | Shiōrra (this project) | CRM (off-limits) |
|---|---|---|
| VPS IP | the IP you paste into `deploy.sh` HOST | 147.93.107.46 |
| Path on VPS | `/opt/shiorra/app` | `/opt/crm` |
| PM2 process | `shiorra-app` | `crm` |
| Repo | `github.com/tech976/Shiorra-` | `github.com/tech976/CRM-` |
| Domain | (set in `scripts/server-setup.sh` DOMAIN var) | crm.digiveritaz.com |
| Port | 3000 | (whatever CRM uses) |

Both scripts hard-abort if any of those collide with CRM values.

---

## First time only — bootstrap the new VPS

> Run this **once**, on the **new Shiōrra VPS**, as root.
> NOT on the CRM VPS at 147.93.107.46.

```bash
# On your Mac — copy the bootstrap to the new VPS
scp scripts/server-setup.sh root@<NEW_VPS_IP>:/root/

# SSH in and run it
ssh root@<NEW_VPS_IP>
chmod +x /root/server-setup.sh
# Optional: edit /root/server-setup.sh and set DOMAIN="shiorra.com" before running
bash /root/server-setup.sh
```

The script:
1. Installs Node 20 LTS, Postgres 16, Nginx, PM2, certbot, ufw
2. Creates Postgres user `shiorra` + database `shiorra` with a random password
3. Creates the `deploy` user (your Mac SSHes in as this user later)
4. Clones the Shiōrra repo to `/opt/shiorra`
5. Writes `/opt/shiorra/app/.env` with the generated DB password + a random `SESSION_SECRET`
6. Installs deps + runs Prisma migrations
7. Starts PM2 process `shiorra-app` + configures it to survive reboot
8. Configures Nginx as reverse proxy (port 80 → 127.0.0.1:3000) with long-cache for `/frames`, `/img`, `/css`, `/js`
9. Configures UFW firewall (22, 80, 443 only)
10. (Optional) Runs certbot for Let's Encrypt SSL if you set `DOMAIN`

At the end it prints the public IP + the next steps for your Mac.

---

## Day-to-day — deploy a change

> Run this from your **Mac**, in this repo.

```bash
# 1. (one-time) edit deploy.sh and set HOST=<your new VPS IP>
$EDITOR deploy.sh

# 2. dry-run to confirm the target — prints every action without changing anything
./deploy.sh --dry-run

# 3. real deploy
./deploy.sh
```

The script:
1. Refuses to run if `HOST` is still the placeholder or matches the CRM IP
2. Refuses to run if you have uncommitted changes
3. Refuses to run if you're on a branch other than `main`
4. Prompts you to confirm before live deploy
5. Pushes `main` to `tech976` remote
6. SSHes to the Shiōrra VPS as `deploy`
7. `git fetch + reset --hard origin/main` in `/opt/shiorra`
8. `npm ci --omit=dev` in `/opt/shiorra/app`
9. `npx prisma migrate deploy`
10. `pm2 reload shiorra-app --update-env`

### Flags

| Flag | What it does |
|---|---|
| `--dry-run` | Print every action; change nothing. Always use first when in doubt. |
| `--skip-push` | Skip the `git push` step (use if the remote is already up to date). |
| `--skip-migrate` | Skip Prisma migrations on the VPS. Use for pure UI deploys to be safer. |
| `-h` \| `--help` | Print usage. |

---

## After-deploy sanity checks

```bash
ssh deploy@<NEW_VPS_IP>
pm2 list                                  # shiorra-app should be "online"
pm2 logs shiorra-app --lines 50           # recent stdout/stderr
curl -sI http://localhost:3000 | head -1  # HTTP/1.1 200 OK
sudo systemctl status nginx               # nginx should be active (running)
```

If anything looks wrong:

```bash
pm2 reload shiorra-app                    # safe reload
pm2 restart shiorra-app                   # hard restart
pm2 logs shiorra-app                      # live logs (Ctrl-C to exit)
```

---

## Rolling back

```bash
ssh deploy@<NEW_VPS_IP>
cd /opt/shiorra
git log --oneline -10        # find the commit you want to revert to
git reset --hard <commit>    # roll the working tree back
cd app && npm ci --omit=dev && pm2 reload shiorra-app
```

If the DB migration is the problem and you need to roll back the schema as
well, you'll need to either keep a `pg_dump` from before the migration or
manually craft a reverse migration. Prisma doesn't auto-down-migrate in prod.

---

## What does NOT live in this pipeline

- **Anything CRM-related.** This script set will abort rather than touch
  `/opt/crm`, the `crm` PM2 process, `tech976/CRM-`, or `147.93.107.46`.
- **Razorpay live keys.** Set them in `/opt/shiorra/app/.env` directly on the
  VPS — they're never committed to git, never passed by `deploy.sh`.
- **Database backups.** Set up a separate `pg_dump | s3 cp` cron on the VPS
  (recommend Backblaze B2 — ~$0.005/GB/mo).
- **Monitoring.** Add UptimeRobot or BetterStack with a free check on `/`
  every 5 min — independent of this deploy pipeline.
