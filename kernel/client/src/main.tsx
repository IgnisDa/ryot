import { RouterProvider } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect } from "react";
import ReactDOM from "react-dom/client";

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
import { makeClientRuntime, type ClientRuntime } from "#/runtime";

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
	const backInterceptors = createBackInterceptors();
	const router = getRouter({ theme, runtime, backInterceptors });
	root.render(
		<ClientApplication
			theme={theme}
			router={router}
			runtime={runtime}
			backInterceptors={backInterceptors}
		/>,
	);
}
