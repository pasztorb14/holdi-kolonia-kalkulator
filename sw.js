/* SmallStep. service worker — v0.9.6
   Network-first for the app shell (index.html and /start/) so a new
   deploy shows up on the next visit. Cache-on-first-use for tex/,
   models/, walk/, audio/, fonts/, draco/, icons/ and start/ assets.
   Relative URLs so this works on GitHub Pages at
   /holdi-kolonia-kalkulator/ and on a local server.
*/
const VERSION = "smallstep-v0.9.6";
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
  "./icons/apple-touch-icon.png",
  "./offline-manifest.json"
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
      || p.endsWith("contact-config.js")
      || p.endsWith("offline-manifest.json");
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


/* ---------- full offline precache (v0.9.6) ---------- */
function absUrl(u) {
  return new URL(u, self.location.href).href;
}

async function loadOfflineManifest() {
  const cache = await caches.open(VERSION);
  const url = absUrl("./offline-manifest.json");
  try {
    const res = await fetch(url, { cache: "reload" });
    if (res && res.ok) {
      cache.put(url, res.clone());
      return res.json();
    }
  } catch (_) {}
  const cached = await cache.match(url) || await cache.match("./offline-manifest.json");
  if (cached) return cached.json();
  throw new Error("offline-manifest.json missing");
}

async function cachedFor(cache, url) {
  const abs = absUrl(url);
  return (await cache.match(abs)) || (await cache.match(url)) || null;
}

async function offlineStatus() {
  const man = await loadOfflineManifest();
  const cache = await caches.open(VERSION);
  let have = 0, haveBytes = 0;
  const missing = [];
  for (const f of man.files) {
    const hit = await cachedFor(cache, f.url);
    if (hit) { have++; haveBytes += f.bytes || 0; }
    else missing.push(f.url);
  }
  // Files the install handler already tries to cache. Having only these
  // is the first-visit state, not an interrupted full download.
  const precacheSet = new Set(PRECACHE.map(function (u) {
    try { return new URL(u, self.location.href).href; } catch (_) { return u; }
  }));
  function inInstallPrecache(url) {
    let abs;
    try { abs = new URL(url, self.location.href).href; } catch (_) { abs = url; }
    if (precacheSet.has(abs) || precacheSet.has(url)) return true;
    // "./start/" and "./start/index.html" are the same shell
    if (/\/start\/?$/.test(abs) || /\/start\/index\.html$/.test(abs)) {
      return precacheSet.has(new URL("./start/", self.location.href).href)
          || precacheSet.has(new URL("./start/index.html", self.location.href).href);
    }
    return false;
  }
  let beyond = 0;
  for (const f of man.files) {
    if (await cachedFor(cache, f.url) && !inInstallPrecache(f.url)) beyond++;
  }
  return {
    type: "status",
    ok: true,
    version: VERSION,
    manifestVersion: man.version || VERSION,
    complete: have === man.files.length && have > 0,
    have: have,
    total: man.files.length,
    haveBytes: haveBytes,
    totalBytes: man.totalBytes,
    missing: missing.length,
    beyond: beyond,
    started: beyond > 0
  };
}

async function precacheAll(port) {
  const man = await loadOfflineManifest();
  const cache = await caches.open(VERSION);
  const files = man.files || [];
  const total = files.length;
  const totalBytes = man.totalBytes || 0;
  let done = 0, bytes = 0;
  const failed = [];
  const report = function (extra) {
    extra = extra || {};
    try {
      port.postMessage(Object.assign({
        type: "progress",
        done: done,
        total: total,
        bytes: bytes,
        totalBytes: totalBytes,
        failed: failed.length
      }, extra));
    } catch (_) {}
  };
  report({ phase: "start" });
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const abs = absUrl(f.url);
    try {
      const existing = await cachedFor(cache, f.url);
      if (existing) {
        done++;
        bytes += f.bytes || 0;
        report();
        continue;
      }
      const res = await fetch(abs, { cache: "reload" });
      if (!res || !res.ok) throw new Error("HTTP " + (res && res.status));
      await cache.put(abs, res);
      done++;
      bytes += f.bytes || 0;
      report();
    } catch (err) {
      const name = err && (err.name || "");
      const quota = name === "QuotaExceededError" || (err && err.code === 22);
      if (quota) {
        report({ phase: "quota", error: "quota" });
        port.postMessage({
          type: "done", ok: false, quota: true,
          done: done, total: total, bytes: bytes, totalBytes: totalBytes,
          failed: failed, error: "quota"
        });
        return;
      }
      failed.push({ url: f.url, error: String(err && err.message || err) });
      report({ failed: failed.length });
    }
  }
  const complete = failed.length === 0 && done === total && total > 0;
  if (complete) {
    await cache.put(absUrl("./offline-complete"), new Response(
      JSON.stringify({ version: VERSION, at: Date.now(), files: total, bytes: bytes }),
      { headers: { "content-type": "application/json" } }
    ));
  }
  port.postMessage({
    type: "done",
    ok: complete,
    done: done, total: total,
    bytes: bytes, totalBytes: totalBytes,
    failed: failed
  });
}

self.addEventListener("message", event => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = function (msg) { if (port) try { port.postMessage(msg); } catch (_) {} };
  if (data.type === "OFFLINE_STATUS") {
    event.waitUntil(offlineStatus().then(reply).catch(function (err) {
      reply({ type: "status", ok: false, error: String(err && err.message || err) });
    }));
    return;
  }
  if (data.type === "OFFLINE_PRECACHE") {
    event.waitUntil(precacheAll(port).catch(function (err) {
      reply({ type: "done", ok: false, error: String(err && err.message || err) });
    }));
  }
});
