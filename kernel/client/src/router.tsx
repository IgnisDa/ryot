import { createRouter as createTanStackRouter, type RouterHistory } from "@tanstack/react-router";

import { createKernelRyotClientStore } from "#/api/ryot-client";
import type { RouterContext } from "#/routes/__root";
import { routeTree } from "#/routeTree.gen";

export type RouterApplicationContext = Omit<RouterContext, "ryotClients">;

export function getRouter(context: RouterApplicationContext, history?: RouterHistory) {
	const router = createTanStackRouter({
		history,
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		context: {
			...context,
			ryotClients: createKernelRyotClientStore(context.runtime, context.theme),
		},
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface HistoryState {
		ryotScreenKey?: string;
	}

	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
