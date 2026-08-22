import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import type { RouterContext } from "./routes/__root";
import { routeTree } from "./routeTree.gen";

export function getRouter(context: RouterContext) {
	const router = createTanStackRouter({
		context,
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
