/// <reference lib="WebWorker" />

import {
	EnhancedCache,
	NavigationHandler,
	clearUpOldCaches,
	logger,
} from "@remix-pwa/sw";

declare let self: ServiceWorkerGlobalScope;

const CURRENT_CACHE_VERSION = "v2";

const _assetCache = new EnhancedCache("remix-assets", {
	version: CURRENT_CACHE_VERSION,
	strategy: "CacheFirst",
	strategyOptions: {
		maxEntries: 2,
		maxAgeSeconds: 60,
		cacheableResponse: false,
	},
});

/**
 * The load context works same as in Remix. The return values of this function will be injected in the worker action/loader.
 * @param {FetchEvent} [event] The fetch event request.
 * @returns {object} the context object.
 */
export const getLoadContext = () => {
	return {};
};

self.addEventListener("install", (event: ExtendableEvent) => {
	logger.log("installing service worker");
	logger.warn(
		"This is a playground service worker 📦. It is not intended for production use.",
	);
	logger.warn("hahaha");
	logger.log("installing service worker");
	event.waitUntil(
		Promise.all([
			self.skipWaiting(),
			// assetCache.preCacheUrls(["/entry.worker.css"]),
			// assetCache.preCacheUrls(self.__workerManifest.assets) // - Ideal, lol. We wish!
		]),
	);
});

self.addEventListener("activate", (event) => {
	logger.log(self.clients, "manifest:\n", self.__workerManifest);
	event.waitUntil(
		Promise.all([
			clearUpOldCaches(["remix-assets"], CURRENT_CACHE_VERSION),
		]).then(() => {
			self.clients.claim();
		}),
	);
});

new NavigationHandler({
	documentCache: new EnhancedCache("remix-document", {
		version: CURRENT_CACHE_VERSION,
		strategy: "CacheFirst",
		strategyOptions: {
			maxEntries: 10,
			maxAgeSeconds: 60,
			cacheableResponse: {
				statuses: [200],
			},
		},
	}),
});

Notification.requestPermission().then((result) => {
	if (result === "granted") {
		navigator.serviceWorker.ready.then((registration) => {
			registration.showNotification("Vibration Sample", {
				body: "Buzz! Buzz!",
				// vibrate: [200, 100, 200, 100, 200, 100, 200],
				tag: "vibration-sample",
			});
		});
	}
});
