import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { InstanceAdminShell } from "#/modules/instance-admin/shell";
import { ServerService } from "#/modules/server/service";

export const Route = createFileRoute("/instance-admin")({
	component: InstanceAdminRoute,
	beforeLoad: ({ context, location }) =>
		context.runtime.runPromise(
			Effect.gen(function* () {
				const server = yield* Effect.flatMap(ServerService, (service) => service.selected);
				if (server === null) {
					// oxlint-disable-next-line typescript/only-throw-error
					throw redirect({ replace: true, to: "/onboarding", search: { redirect: location.href } });
				}
				return { server };
			}),
		),
});

function InstanceAdminRoute() {
	const { server, runtime } = Route.useRouteContext();
	return <InstanceAdminShell server={server} runtime={runtime} />;
}
