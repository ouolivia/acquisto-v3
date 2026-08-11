const CACHE_PREFIX = 'procure-easy-v3-';
const CACHE = 'procure-easy-v3-photo-35';
const ASSETS = ['./','index.html','styles.css?v=5','theme.css?v=4','reference.css?v=2','photo.css?v=15','transfer.css?v=2','photo.js?v=5','drive.js?v=1','pricing.js?v=1','app.js?v=33','manifest.webmanifest','icon.svg','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if(event.request.mode === 'navigate'){
    event.respondWith(fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put('./',copy));
      return response;
    }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('./'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
