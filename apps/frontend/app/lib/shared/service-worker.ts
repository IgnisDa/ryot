import type {
	AppServiceWorkerMessageData,
	SendNotificationProps,
} from "../types";
import { LOGO_IMAGE_URL } from "./constants";

export const sendNotificationToServiceWorker = (props: SendNotificationProps) =>
	navigator.serviceWorker.ready.then((registration) => {
		registration.showNotification(props.title, {
			silent: true,
			tag: props.tag,
			body: props.body,
			data: props.data,
			icon: LOGO_IMAGE_URL,
		});
	});

export const postMessageToServiceWorker = (
	message: AppServiceWorkerMessageData,
) => {
	if (navigator.serviceWorker?.controller)
		navigator.serviceWorker.controller.postMessage(message);
};
