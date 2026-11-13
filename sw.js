/* SmallStep. service worker — v0.9.5
   Network-first for the app shell (index.html and /start/) so a new
   deploy shows up on the next visit. Cache-on-first-use for tex/,
   models/, walk/, audio/, fonts/, draco/, icons/ and start/ assets.
   Relative URLs so this works on GitHub Pages at
   /holdi-kolonia-kalkulator/ and on a local server.
*/
const VERSION = "smallstep-v0.9.5";
const PRECACHE = [
  "./index.html",
  "./start/",
  "./start/index.html",
  "./start/moon-1280.webp",
  "./start/stars-1200.webp",
  "./start/fonts/Exo2-var-latin.woff2",
  "./start/fonts/Michroma-Regular.woff2",
  "./start/fonts/Inter-Regular.woff2",
  "./start/wordmark.png",
  "./icons/smallstep-wordmark.png",
  "./manifest.webmanifest",
  "./contact-config.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const url of PRECACHE) {
      try {
        const res = await fetch(url, { cache: "reload" });
        if (res && res.ok) await cache.put(url, res);
      } catch (_) { /* a missing file must not block install */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isStart(url) {
  return /\/start(?:\/|\/index\.html)?$/.test(url.pathname);
}

function isShell(url, request) {
  if (request.mode === "navigate") return true;
  const p = url.pathname;
  return /(?:\/index\.html|\/|\/holdi-kolonia-kalkulator)$/.test(p) || isStart(url);
}

function isCachableAsset(url) {
  const p = url.pathname;
  return /\/(tex|models|walk|audio|fonts|draco|icons|start)\//.test(p)
      || p.endsWith(".webmanifest")
      || p.endsWith("contact-config.js");
}

function shellFallbacks(url) {
  if (isStart(url)) {
    return ["./start/index.html", "./start/", new URL("./start/index.html", self.location.href).href];
  }
  return ["./index.html", new URL("./index.html", self.location.href).href];
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  const url = new URL(request.url);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      cache.put(request, res.clone());
      if (request.mode === "navigate") {
        const key = isStart(url) ? "./start/index.html" : "./index.html";
        cache.put(key, res.clone());
      }
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    for (const fb of shellFallbacks(url)) {
      const hit = await cache.match(fb);
      if (hit) return hit;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  if (isShell(url, request)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isCachableAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
