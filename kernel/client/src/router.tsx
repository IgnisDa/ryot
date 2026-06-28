import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import type { RouterContext } from "./routes/__root";
import { routeTree } from "./routeTree.gen";

function RestoringSession() {
	return (
		<main className="ui-page">
			<section
				aria-labelledby="session-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="session-title" className="ui-heading">
						Restoring your session
					</h1>
					<p role="status" className="ui-subtitle">
						Checking your signed-in state...
					</p>
				</div>
			</section>
		</main>
	);
}

export function getRouter(context: RouterContext) {
	const router = createTanStackRouter({
		context,
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		defaultPendingComponent: RestoringSession,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
