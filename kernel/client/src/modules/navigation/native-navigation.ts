import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { Effect } from "effect";

import {
	createDeepLinkBridge,
	type DeepLinkClaims,
	type DeepLinkNavigator,
	type NativeAppSource,
} from "#/modules/navigation/deep-link";

export const nativeListener = <E>(add: Effect.Effect<PluginListenerHandle, E>) =>
	Effect.map(add, (listener) => () => void listener.remove());

const capacitorAppSource: NativeAppSource = {
	exitApp: () => void App.exitApp(),
	getLaunchUrl: () =>
		Effect.tryPromise(() => App.getLaunchUrl()).pipe(Effect.map((launch) => launch?.url ?? null)),
	onBackButton: (handler) =>
		nativeListener(Effect.tryPromise(() => App.addListener("backButton", () => handler()))),
	onUrlOpen: (handler) =>
		nativeListener(
			Effect.tryPromise(() => App.addListener("appUrlOpen", (event) => handler(event.url))),
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
