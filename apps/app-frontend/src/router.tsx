import { createRouter } from "@tanstack/react-router";

import ApiClientProvider from "./hooks/api";
import ReactQueryProvider from "./hooks/react-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		Wrap: ({ children }) => (
			<ReactQueryProvider>
				<ApiClientProvider>{children}</ApiClientProvider>
			</ReactQueryProvider>
		),
	});

	return router;
}
