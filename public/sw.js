// Offline for attendance only (docs/01 "Offline", agreed 2026-09-23).
// Static assets: cache first. /today and /sessions/*: network first, cached copy
// offline. Anything else offline: a short page pointing back to Today.
const STATIC = "bravitar-static-v1";
const PAGES = "bravitar-pages"; // holds student names: cleared on sign-out

const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><body style="font-family:system-ui;padding:24px;background:#f7f7f6;color:#1a1a18">
<h1 style="font-size:20px">You're offline</h1><p>Only attendance works offline.</p>
<p><a href="/today" style="color:#2b5fd9">Open Today</a></p></body>`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("bravitar-static-") && key !== STATIC) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

const isAttendancePage = (url) => url.pathname === "/today" || url.pathname.startsWith("/sessions/");
const pageKey = (url) => url.origin + url.pathname; // ?all=1 and friends share one copy
const offlinePage = () => new Response(OFFLINE, { headers: { "content-type": "text/html; charset=utf-8" } });

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) return event.respondWith(cacheFirst(req));
  if (req.mode !== "navigate") return; // RSC, API: always the network
  event.respondWith(isAttendancePage(url) ? networkFirst(req, url) : fetch(req).catch(offlinePage));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(STATIC)).put(req, res.clone());
  return res;
}

async function networkFirst(req, url) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected) cache.put(pageKey(url), res.clone());
    return res;
  } catch {
    return (await cache.match(pageKey(url))) ?? offlinePage();
  }
}

// The page asks for today's rosters to be ready before the signal goes.
async function cachePages(urls) {
  const pages = await caches.open(PAGES);
  const assets = new Set();
  for (const u of urls) {
    try {
      const res = await fetch(u, { credentials: "include" });
      if (!res.ok || res.redirected) continue;
      const html = await res.clone().text();
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1]);
      await pages.put(pageKey(new URL(u, self.location.origin)), res);
    } catch {}
  }
  const cache = await caches.open(STATIC);
  for (const a of assets) if (!(await cache.match(a))) await cache.add(a).catch(() => {});
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "cache-pages") event.waitUntil(cachePages(event.data.urls));
});
