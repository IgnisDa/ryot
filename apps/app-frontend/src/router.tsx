import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import ApiClientProvider from "./hooks/api";
import AuthClientProvider, { authClientInstance } from "./hooks/auth";
import ReactQueryProvider from "./hooks/react-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
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
