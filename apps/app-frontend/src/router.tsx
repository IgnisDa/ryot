import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import ApiClientProvider from "./hooks/api";
import AuthClientProvider from "./hooks/auth";
import ReactQueryProvider from "./hooks/react-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
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

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
