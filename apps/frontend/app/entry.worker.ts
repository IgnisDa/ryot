/// <reference lib="WebWorker" />

import { logger } from "@remix-pwa/sw";
import { match } from "ts-pattern";
import type {
	AppServiceWorkerNotificationTag,
	AppServiceWorkerMessageData,
} from "~/lib/generals";

declare let self: ServiceWorkerGlobalScope;

self.addEventListener("install", (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", ({ notification }) => {
	notification.close();
});

self.addEventListener("message", (event) => {
	const data = event.data as AppServiceWorkerMessageData;
	logger.debug(`Received message: ${data.event}`);
	match(data.event)
		.with("remove-timer-completed-notification", () => {
			self.registration.getNotifications().then((notifications) => {
				for (const notification of notifications) {
					const tag = notification.tag as AppServiceWorkerNotificationTag;
					if (tag === "timer-completed") notification.close();
				}
			});
		})
		.exhaustive();
});
