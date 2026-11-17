import { loadKernelCatalog } from "@ryot-app/kernel-messages/catalog";
import { catalog as sourceCatalog } from "@ryot-app/kernel-messages/locales/en";
import { useFocusedFieldVisibility } from "@ryot-app/plugin-ui-sdk";
import { RouterProvider } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect } from "react";
import ReactDOM from "react-dom/client";

import { createI18nStore } from "#/modules/i18n/store";
import {
	captureOAuthReturnFragment,
	OAuthReturnCapture,
} from "#/modules/integrations/oauth-return";
import {
	type BackInterceptors,
	createBackInterceptors,
} from "#/modules/navigation/back-interceptors";
import { DeepLinkClaims } from "#/modules/navigation/deep-link";
import { startNativeNavigation } from "#/modules/navigation/native-navigation";
import { createThemeStore, type ThemeStore } from "#/modules/theme/store";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import { type ClientRuntime, makeClientRuntime } from "#/runtime";

function ClientApplication(props: {
	readonly theme: ThemeStore;
	readonly runtime: ClientRuntime;
	readonly backInterceptors: BackInterceptors;
	readonly router: ReturnType<typeof getRouter>;
}) {
	const { router, runtime, backInterceptors } = props;
	useEffect(() => {
		const navigation = startNativeNavigation(
			{
				back: () => router.history.back(),
				canGoBack: () => router.history.canGoBack(),
				dismissOverlay: () => backInterceptors.run(),
				navigate: (href, options) => void router.navigate({ href, replace: options.replace }),
			},
			runtime.runSync(DeepLinkClaims),
		);
		return () => navigation.destroy();
	}, [backInterceptors, router, runtime]);
	useFocusedFieldVisibility();
	useEffect(
		() => () => {
			props.theme.destroy();
			void props.runtime.dispose();
		},
		[props.runtime, props.theme],
	);
	return <RouterProvider router={props.router} />;
}

const rootElement = document.getElementById("app");

if (rootElement === null) {
	throw new Error("Missing application root");
}

if (!rootElement.innerHTML) {
	const oauthReturn = captureOAuthReturnFragment(window.location, window.history);
	const root = ReactDOM.createRoot(rootElement);
	const runtime = makeClientRuntime();
	runtime.runSync(Effect.flatMap(OAuthReturnCapture, (capture) => capture.record(oauthReturn)));
	const initialThemePreference = runtime.runSync(
		Effect.flatMap(ClientStorage, (storage) => storage.getThemePreference),
	);
	const theme = createThemeStore(initialThemePreference);
	const i18n = createI18nStore({
		sourceCatalog,
		load: loadKernelCatalog,
		deviceLocales: navigator.languages,
		run: (effect) => void runtime.runFork(effect),
		initialPreference: runtime.runSync(
			Effect.flatMap(ClientStorage, (storage) => storage.getInterfaceLocale),
		),
	});
	const backInterceptors = createBackInterceptors();
	const router = getRouter({ i18n, theme, runtime, backInterceptors });
	root.render(
		<ClientApplication
			theme={theme}
			router={router}
			runtime={runtime}
			backInterceptors={backInterceptors}
		/>,
	);
}
