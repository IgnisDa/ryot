import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected")({
	component: RouteComponent,
	beforeLoad: async ({ context, location }) => {
		const session = await context.authClientInstance.getSession();
		if (!session.data)
			throw redirect({
				to: "/start",
				search: { redirect: location.href },
			});

		return { user: session.data.user };
	},
});

function RouteComponent() {
	return <Outlet />;
}
