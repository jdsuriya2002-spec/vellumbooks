require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const { getAll } = require("./utils/settings");
const { startReservationCleanup } = require("./utils/reservationCleanup");

const booksRouter = require("./routes/books");
const { router: checkoutRouter } = require("./routes/checkout");
const webhookRouter = require("./routes/webhook");
const adminRouter = require("./routes/admin");
const { spineColor, currency } = require("./utils/viewHelpers");

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.locals.spineColor = spineColor;
app.locals.currency = currency;
app.use(cors());

// IMPORTANT: the Razorpay webhook needs the exact raw request body to verify
// its signature, so it's mounted BEFORE express.json() and given its own
// raw-body parser. Any route after express.json() below gets parsed JSON.
app.use("/api/webhooks", express.raw({ type: "application/json" }), webhookRouter);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- API ----------
app.use("/api/books", booksRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/admin", adminRouter);

// ---------- SEO-rendered public pages ----------

app.get("/", (req, res) => {
  const settings = getAll();
  const featured = db
    .prepare("SELECT * FROM books WHERE status = 'available' ORDER BY created_at DESC LIMIT 8")
    .all();
  const totalAvailable = db.prepare("SELECT COUNT(*) AS c FROM books WHERE status = 'available'").get().c;
  const soldCount = db.prepare("SELECT COUNT(*) AS c FROM books WHERE status = 'sold'").get().c;
  const totalSold = soldCount + (Number(settings.books_sold_offset) || 0);
  const NEW_ARRIVAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const newArrivalCutoff = Date.now() - NEW_ARRIVAL_WINDOW_MS;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BookStore",
    name: settings.site_name,
    description: settings.meta_description,
    telephone: settings.contact_phone_1,
    email: settings.contact_email,
    address: settings.shop_address,
    url: SITE_URL,
  };
  res.render("index", {
    settings,
    featured,
    totalAvailable,
    totalSold,
    newArrivalCutoff,
    siteUrl: SITE_URL,
    activeNav: "home",
    structuredData,
  });
});

app.get("/catalog", (req, res) => {
  const settings = getAll();
  const books = db.prepare("SELECT * FROM books ORDER BY created_at DESC").all();
  const categories = db.prepare("SELECT DISTINCT category FROM books ORDER BY category").all().map((r) => r.category);
  const newArrivalCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  res.render("catalog", {
    settings,
    books,
    categories,
    newArrivalCutoff,
    siteUrl: SITE_URL,
    activeNav: "catalog",
    pageTitle: `Catalog — Pre-Owned Professional Books | ${settings.site_name}`,
    pageDescription: `Browse ${books.length}+ pre-owned engineering, medical, law, management and competitive-exam books, filterable by subject and condition.`,
    canonicalPath: "/catalog",
  });
});

app.get("/book/:id", (req, res) => {
  const settings = getAll();
  const book = db.prepare("SELECT * FROM books WHERE id = ?").get(req.params.id);
  if (!book) return res.status(404).render("not-found", { settings, siteUrl: SITE_URL, activeNav: "" });

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: book.title,
    description: book.description,
    category: book.category,
    offers: {
      "@type": "Offer",
      price: book.price,
      priceCurrency: "INR",
      availability: book.status === "available" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${SITE_URL}/book/${book.id}`,
    },
    itemCondition: "https://schema.org/UsedCondition",
  };

  res.render("book", {
    settings,
    book,
    siteUrl: SITE_URL,
    activeNav: "catalog",
    pageTitle: `${book.title} — ${book.condition}, ₹${book.price} | ${settings.site_name}`,
    pageDescription: `${book.title} by ${book.author}, pre-owned in ${book.condition} condition — ₹${book.price}. ${book.description}`.slice(0, 300),
    canonicalPath: `/book/${book.id}`,
    ogImage: book.image_path || undefined,
    structuredData,
  });
});

app.get("/contact", (req, res) => {
  const settings = getAll();
  res.render("contact", {
    settings,
    siteUrl: SITE_URL,
    activeNav: "contact",
    pageTitle: `Contact & WhatsApp — ${settings.site_name}`,
    pageDescription: `Ask ${settings.site_name} about a book's condition or edition before you buy — WhatsApp, phone or the contact form.`,
    canonicalPath: "/contact",
  });
});

app.get("/community", (req, res) => {
  const settings = getAll();
  const reviews = db.prepare("SELECT * FROM reviews ORDER BY created_at DESC").all();
  const allEvents = db.prepare("SELECT * FROM community_events ORDER BY event_date ASC").all();
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingEvents = allEvents.filter((e) => e.event_date >= todayStr);
  const pastEvents = allEvents.filter((e) => e.event_date < todayStr).reverse();
  res.render("community", {
    settings,
    reviews,
    upcomingEvents,
    pastEvents,
    siteUrl: SITE_URL,
    activeNav: "community",
    pageTitle: `Community — Reader Reviews & Book Club | ${settings.site_name}`,
    pageDescription: `What readers say about ${settings.site_name}, plus upcoming book club meetups and events.`,
    canonicalPath: "/community",
  });
});

// ---------- SEO plumbing ----------

app.get("/sitemap.xml", (req, res) => {
  const books = db.prepare("SELECT id, updated_at FROM books").all();
  const staticUrls = ["", "/catalog", "/contact", "/community"];
  const urls = [
    ...staticUrls.map((u) => `<url><loc>${SITE_URL}${u}</loc></url>`),
    ...books.map(
      (b) => `<url><loc>${SITE_URL}/book/${b.id}</loc><lastmod>${new Date(b.updated_at).toISOString()}</lastmod></url>`
    ),
  ];
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`
  );
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

// ---------- admin static SPA (its own auth is handled client-side + every API call is server-verified) ----------
app.get("/admin*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "index.html"));
});

app.use((req, res) => {
  const settings = getAll();
  res.status(404).render("not-found", { settings, siteUrl: SITE_URL, activeNav: "" });
});

startReservationCleanup();

app.listen(PORT, () => {
  console.log(`VellumBooks running at ${SITE_URL} (port ${PORT})`);
});
