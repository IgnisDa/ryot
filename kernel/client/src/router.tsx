import { createRouter as createTanStackRouter, type RouterHistory } from "@tanstack/react-router";

import type { RouterContext } from "#/routes/__root";
import { routeTree } from "#/routeTree.gen";

export function getRouter(context: RouterContext, history?: RouterHistory) {
	const router = createTanStackRouter({
		context,
		history,
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
