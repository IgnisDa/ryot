import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { GodModeShell } from "#/modules/god-mode/shell";
import { ServerService } from "#/modules/server/service";

export const Route = createFileRoute("/god-mode")({
	component: GodModeRoute,
	beforeLoad: ({ context, location }) =>
		context.runtime
			.runPromise(Effect.flatMap(ServerService, (service) => service.selected))
			.then((server) => {
				if (server === null) {
					// oxlint-disable-next-line typescript/only-throw-error
					throw redirect({ replace: true, to: "/onboarding", search: { redirect: location.href } });
				}
				return { server };
			}),
});

function GodModeRoute() {
	const { server, runtime } = Route.useRouteContext();
	return <GodModeShell server={server} runtime={runtime} />;
}
