/// <reference lib="WebWorker" />

import { match } from "ts-pattern";
import type {
	AppServiceWorkerMessageData,
	AppServiceWorkerNotificationData,
	AppServiceWorkerNotificationTag,
} from "~/lib/types";

declare let clients: Clients;
declare let self: ServiceWorkerGlobalScope;

const logger = {
	debug: (...args: unknown[]) => console.debug("[SW]", ...args),
};

self.addEventListener("install", (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	if (event.notification.data) {
		logger.debug("Received notification data", event.notification.data);
		const data = event.notification.data as AppServiceWorkerNotificationData;
		match(data.event)
			.with("open-link", () => {
				const urlToOpen = data.link;
				if (!urlToOpen) return;
				event.waitUntil(
					clients
						.matchAll({ type: "window", includeUncontrolled: true })
						.then((clientList) => {
							for (let i = 0; i < clientList.length; i++) {
								const client = clientList[i];
								if (client.url === urlToOpen && "focus" in client)
									return client.focus();
							}
							if (clients.openWindow) return clients.openWindow(urlToOpen);
						}),
				);
			})
			.exhaustive();
	}
});

self.addEventListener("message", (event) => {
	const data = event.data as AppServiceWorkerMessageData;
	logger.debug("Received message", data);
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
