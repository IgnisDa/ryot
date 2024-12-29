import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createClientOnlyFn } from "@tanstack/react-start";
import type { AuthClient } from "#/hooks/auth";

const getSession = createClientOnlyFn(
	async (authClientInstance: AuthClient) => {
		const session = await authClientInstance.getSession();
		return session;
	},
);

export const Route = createFileRoute("/_protected")({
	component: RouteComponent,
	beforeLoad: async ({ context, location }) => {
		const { data } = await getSession(context.authClientInstance);
		if (!data)
			throw redirect({
				to: "/start",
				search: { redirect: location.href },
			});

		return { user: data.user };
	},
});

function RouteComponent() {
	return <Outlet />;
}
