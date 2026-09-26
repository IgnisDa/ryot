import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import {
	createDeepLinkBridge,
	type DeepLinkNavigator,
	type NativeAppSource,
} from "#/modules/navigation/deep-link";

const capacitorAppSource: NativeAppSource = {
	exitApp: () => void App.exitApp(),
	getLaunchUrl: () => App.getLaunchUrl().then((launch) => launch?.url ?? null),
	onBackButton: (handler) =>
		App.addListener("backButton", () => handler()).then((listener) => () => void listener.remove()),
	onUrlOpen: (handler) =>
		App.addListener("appUrlOpen", (event) => handler(event.url)).then(
			(listener) => () => void listener.remove(),
		),
};

export const isNativePlatform = () => Capacitor.isNativePlatform();

export function startNativeNavigation(navigator: DeepLinkNavigator) {
	if (!isNativePlatform()) {
		return { destroy: () => {} };
	}
	return createDeepLinkBridge(capacitorAppSource, navigator);
}
