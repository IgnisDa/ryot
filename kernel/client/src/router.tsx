import {
	createBrowserHistory,
	createRouter as createTanStackRouter,
	type RouterHistory,
} from "@tanstack/react-router";

import { createKernelRyotClientStore } from "#/api/ryot-client";
import type { RouterContext } from "#/routes/__root";
import { routeTree } from "#/routeTree.gen";

export type RouterApplicationContext = Omit<RouterContext, "ryotClients" | "hostedOAuthQuery">;

export function getRouter(
	context: RouterApplicationContext,
	history: RouterHistory = createBrowserHistory(),
) {
	const router = createTanStackRouter({
		history,
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 30_000,
		context: {
			...context,
			// Parsed router locations reserialize search parameters; OAuth signatures require the raw query.
			hostedOAuthQuery: () => history.location.search.slice(1),
			ryotClients: createKernelRyotClientStore(context.runtime, context.theme),
		},
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface HistoryState {
		ryotEntryKey?: string;
	}

	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
