# VellumBooks

A full working backend + website for a pre-owned professional-books shop:
catalog, real-time reservation locking, Razorpay checkout, pickup/shipping
fulfillment, and an admin panel for weekly catalog updates.

This is a real Node.js application with its own database — not a static
site. It needs to run on a server (not shared/basic hosting).

---

## 1. What's inside

```
server/           Express backend (API, database, Razorpay, auth)
views/            Server-rendered pages (home, catalog, book detail, contact) — for SEO
public/           Static files: CSS, client JS, uploaded book photos, admin panel
data/             SQLite database file lives here (created automatically)
.env.example      Copy to .env and fill in your real values
```

The public-facing pages (home, catalog, book detail, contact) are
server-rendered so search engines see real content immediately. The admin
panel is a small single-page app that talks to the API — it's not indexed
(`robots.txt` blocks `/admin`).

---

## 2. Run it locally first

You'll need [Node.js](https://nodejs.org) **22.5 or newer** installed (this
uses Node's built-in SQLite support, so there's no separate database engine
to install and nothing that needs a C++ compiler on your machine).

```bash
cd vellumbooks
npm install
cp .env.example .env
```

Open `.env` and set at minimum:

- `JWT_SECRET` — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — your first admin login (change
  the password from the Settings tab immediately after logging in).

Leave `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` blank for now — the site
runs in **test mode** automatically and lets you click through the whole
checkout flow with a "Simulate Successful Payment" button, no real payment
gateway needed yet.

Then:

```bash
npm run seed     # creates your admin login + 10 demo books
npm start        # starts the site at http://localhost:3000
```

Visit `http://localhost:3000` for the site, `http://localhost:3000/admin`
for the admin panel.

**Try the full flow:** browse the catalog → open a book → Add to Cart →
Reserve & Checkout → fill in details → Simulate Payment → check the Admin
panel's Orders tab. Try reserving the same book from two browser tabs to see
the real locking in action (the second one gets rejected).

---

## 3. Setting up Razorpay (for real payments)

1. Create a [Razorpay account](https://razorpay.com) and complete KYC —
   required before you can accept live payments.
2. In the Razorpay Dashboard: **Settings → API Keys** → generate a key pair.
   - Start with **Test Mode** keys (`rzp_test_...`) to try real Razorpay
     checkout without moving real money.
   - Switch to **Live Mode** keys once you're ready to launch.
3. Put the **Key Secret** in your server's `.env` file as
   `RAZORPAY_KEY_SECRET` — never share this, never put it in the admin panel
   or any file that reaches the browser.
4. Put the **Key ID** (the public one, safe to expose) into the
   **Admin panel → Settings → Razorpay → Key ID** field. You can change this
   anytime without redeploying — that's the "editable payment link" piece.
5. **Webhook (important — this is your safety net):**
   - Dashboard → **Settings → Webhooks → Add New Webhook**
   - URL: `https://yourdomain.com/api/webhooks/razorpay`
   - Active events: check **`payment.captured`**
   - Copy the **Webhook Secret** it gives you into `.env` as
     `RAZORPAY_WEBHOOK_SECRET`.
   - Why this matters: if a customer pays but closes their browser before
     the confirmation call finishes, the webhook is what still marks the
     order as paid. Without it, a handful of real payments could go
     unrecorded.

---

## 4. Deploying on Hostinger

**Important:** Hostinger's regular *shared hosting* plans only run PHP —
they cannot run this Node.js app. You need **Hostinger VPS** (or **Cloud
Hosting**, which is VPS-based). If you'd rather not manage a VPS yourself,
alternatives like Railway or Render also work and are simpler to deploy to,
with Hostinger just holding your domain and DNS.

### On a Hostinger VPS (Ubuntu):

1. **SSH into your VPS**, then install Node.js and a process manager:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
   sudo apt install -y nodejs
   sudo npm install -g pm2
   ```

2. **Upload the project** (via `git clone` if you push this to a private
   GitHub repo, or `scp`/an SFTP client like FileZilla).

3. **Install and configure:**
   ```bash
   cd vellumbooks
   npm install --production
   cp .env.example .env
   nano .env   # fill in real JWT_SECRET, Razorpay keys, SITE_URL=https://vellumbooks.com
   npm run seed
   ```

4. **Start it with PM2** (keeps it running, restarts on crash or reboot):
   ```bash
   pm2 start server/index.js --name vellumbooks
   pm2 save
   pm2 startup   # follow the printed instructions to enable on-boot start
   ```

5. **Point your domain at it with Nginx** (Hostinger VPS ships with Nginx,
   or install with `sudo apt install nginx`). Create
   `/etc/nginx/sites-available/vellumbooks`:
   ```nginx
   server {
       listen 80;
       server_name vellumbooks.com www.vellumbooks.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
   ```bash
   sudo ln -s /etc/nginx/sites-available/vellumbooks /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

6. **Add free SSL** with Let's Encrypt:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d vellumbooks.com -d www.vellumbooks.com
   ```

7. In Hostinger's DNS settings for your domain, point the **A record** at
   your VPS's IP address.

That's it — `https://vellumbooks.com` now serves the live site, backed by
the real Node process behind Nginx.

### Backing up the database

Everything lives in one file: `data/vellumbooks.sqlite`. Back it up
regularly, e.g. a nightly cron job copying it somewhere safe:
```bash
0 2 * * * cp /path/to/vellumbooks/data/vellumbooks.sqlite /path/to/backups/vellumbooks-$(date +\%F).sqlite
```

---

## 5. Running the shop week to week

- **Add/edit/delist books:** Admin → Catalog tab. Cover photo uploads
  directly from your phone or computer.
- **See who's paid and needs fulfillment:** Admin → Orders tab → "mark
  fulfilled" once you've handed it over or shipped it.
- **Manual shipping quotes** (orders over the weight threshold): Admin →
  Orders tab → "set shipping cost" once you've weighed the parcel.
- **Active holds** (books currently locked by someone mid-checkout): Admin →
  Holds tab. These release automatically after 15 minutes if unpaid — no
  action needed.
- **Questions from customers:** Admin → Inquiries tab, or they'll message
  your WhatsApp directly.
- **Change contact info, WhatsApp number, SEO description/keywords, or
  shipping rates:** Admin → Settings tab — no code changes needed.
- **People waiting on a sold-out or reserved book:** Admin → Notify List tab.
  Anyone who filled in "notify me" on a book page shows up here — reach out
  on WhatsApp when a similar copy comes in, then mark it done.
- **Your founder note and books-sold counter:** Admin → Settings → Founder
  note. Leave the name blank to hide that section on the home page entirely.
  The counter (books sold) counts real sales automatically — the "books sold
  before this site existed" field just adds a starting number on top, for
  sales you made before going digital.
- Books listed in the last 7 days automatically get a **"New" badge** on the
  home page and catalog — no action needed, it's based on when you added
  the book.

---

## 6. SEO notes

- Every book page has its own title, meta description, and Product
  structured data (helps Google show price/availability in search results).
- `sitemap.xml` and `robots.txt` are generated automatically and update as
  you add books — no manual maintenance.
- Edit the meta description and keywords anytime from Admin → Settings →
  SEO, without a code deploy.
- Once live, submit your sitemap (`https://vellumbooks.com/sitemap.xml`) to
  [Google Search Console](https://search.google.com/search-console) to help
  Google index it faster.

---

## 7. Security notes worth knowing

- The Razorpay **Key Secret** and **Webhook Secret** only ever live in
  `.env` on the server — they're never sent to the browser or stored in the
  database, unlike the public Key ID.
- Admin sessions expire after 12 hours; change the seeded password
  immediately after first login.
- All admin API routes require a valid login token — the admin panel's
  "login screen" isn't just cosmetic, it's enforced server-side.
- `.env` is in `.gitignore` — never commit it if you push this to GitHub.
