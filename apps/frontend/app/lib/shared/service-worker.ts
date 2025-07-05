import type {
	AppServiceWorkerMessageData,
	AppServiceWorkerNotificationData,
	AppServiceWorkerNotificationTag,
} from "../types";
import { LOGO_IMAGE_URL } from "./constants";

export const sendNotificationToServiceWorker = (
	title: string,
	body: string,
	tag?: AppServiceWorkerNotificationTag,
	data?: AppServiceWorkerNotificationData,
) =>
	navigator.serviceWorker.ready.then((registration) => {
		registration.showNotification(title, {
			tag,
			body,
			data,
			silent: true,
			icon: LOGO_IMAGE_URL,
		});
	});

export const postMessageToServiceWorker = (
	message: AppServiceWorkerMessageData,
) => {
	if (navigator.serviceWorker?.controller)
		navigator.serviceWorker.controller.postMessage(message);
};
