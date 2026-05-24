import { createRouter as createTanStackRouter, type RouterHistory } from "@tanstack/react-router";

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

export function getRouter(context: RouterContext, history?: RouterHistory) {
	const router = createTanStackRouter({
		context,
		history,
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
