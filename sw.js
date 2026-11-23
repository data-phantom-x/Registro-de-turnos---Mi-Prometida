'use strict';

/*
 * Registro de Turnos PWA
 * - La aplicación y sus recursos locales se guardan para abrirse sin conexión.
 * - Las librerías externas estáticas se pueden reutilizar sin conexión.
 * - Firebase, autenticación, API de feriados y analítica SIEMPRE usan la red:
 *   no se almacenan respuestas con datos personales ni credenciales.
 */

const PWA_VERSION = '1.0.1';
const APP_CACHE = `registro-turnos-app-v${PWA_VERSION}`;
const RUNTIME_CACHE = `registro-turnos-runtime-v${PWA_VERSION}`;
const BASE_URL = new URL('./', self.location.href);
const asset = (path) => new URL(path, BASE_URL).href;

const APP_SHELL = [
  asset(''),
  asset('index.html'),
  asset('offline.html'),
  asset('manifest.webmanifest'),
  asset('logo.svg'),
  asset('logo-maskable.svg'),
  asset('favicon.svg'),
  asset('favicon.ico'),
  asset('favicon-16.png'),
  asset('favicon-32.png'),
  asset('apple-touch-icon.png'),
  asset('icons/icon-16x16.png'),
  asset('icons/icon-32x32.png'),
  asset('icons/icon-48x48.png'),
  asset('icons/icon-72x72.png'),
  asset('icons/icon-96x96.png'),
  asset('icons/icon-128x128.png'),
  asset('icons/icon-144x144.png'),
  asset('icons/icon-152x152.png'),
  asset('icons/icon-192x192.png'),
  asset('icons/icon-384x384.png'),
  asset('icons/icon-512x512.png'),
  asset('icons/icon-maskable-192x192.png'),
  asset('icons/icon-maskable-512x512.png')
];

// Solo estos dominios contienen archivos estáticos. Los datos de Firebase,
// autenticación, feriados y analítica quedan fuera de la caché.
const STATIC_HOSTS = new Set([
  'www.gstatic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com'
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('registro-turnos-') && name !== APP_CACHE && name !== RUNTIME_CACHE)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(APP_CACHE);
  let response = null;

  try {
    response = await fetch(request);
  } catch (error) {
    // Sin red: se usa la copia local.
  }

  if (response && response.ok) {
    await cache.put(asset('index.html'), response.clone());
    return response;
  }

  // Un 404 normal debe mostrarse; un error 5xx se trata como falta de conexión.
  if (response && response.status < 500) return response;

  return (
    (await cache.match(asset('index.html'))) ||
    (await cache.match(asset(''))) ||
    (await cache.match(asset('offline.html'))) ||
    new Response(
      '<!doctype html><meta charset="utf-8"><title>Sin conexión</title>' +
      '<p style="font-family:system-ui;padding:2rem">No hay conexión y la aplicación aún no está disponible sin conexión.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    )
  );
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise);
    return cached;
  }

  const response = await networkPromise;
  return response || Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

  if (STATIC_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Firebase, autenticación, la API de feriados y analítica no se cachean.
});
