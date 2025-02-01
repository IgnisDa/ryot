import { createRouter } from "@tanstack/react-router";
import ApiClientProvider from "./hooks/api";
import AuthClientProvider, { authClientInstance } from "./hooks/auth";
import ReactQueryProvider from "./hooks/react-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		context: { authClientInstance },
		Wrap: ({ children }) => (
			<ReactQueryProvider>
				<ApiClientProvider>
					<AuthClientProvider>{children}</AuthClientProvider>
				</ApiClientProvider>
			</ReactQueryProvider>
		),
	});

	return router;
}
