/// <reference lib="WebWorker" />

export type {};

declare let self: ServiceWorkerGlobalScope;

self.addEventListener("install", (event) => {
	console.log("Service worker installed");

	event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
	console.log("Service worker activated");

	event.waitUntil(self.clients.claim());
});
