import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Effect } from "effect";

import {
	createDeepLinkBridge,
	type DeepLinkClaims,
	type DeepLinkNavigator,
	type NativeAppSource,
} from "#/modules/navigation/deep-link";

const capacitorAppSource: NativeAppSource = {
	exitApp: () => void App.exitApp(),
	getLaunchUrl: () =>
		Effect.tryPromise(() => App.getLaunchUrl()).pipe(Effect.map((launch) => launch?.url ?? null)),
	onBackButton: (handler) =>
		Effect.tryPromise(() => App.addListener("backButton", () => handler())).pipe(
			Effect.map((listener) => () => void listener.remove()),
		),
	onUrlOpen: (handler) =>
		Effect.tryPromise(() => App.addListener("appUrlOpen", (event) => handler(event.url))).pipe(
			Effect.map((listener) => () => void listener.remove()),
		),
};

export const isNativePlatform = () => Capacitor.isNativePlatform();

export function startNativeNavigation(
	navigator: DeepLinkNavigator,
	claims: DeepLinkClaims["Service"],
) {
	if (!isNativePlatform()) {
		return { destroy: () => {} };
	}
	return createDeepLinkBridge(capacitorAppSource, navigator, claims);
}
