import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected")({
	component: RouteComponent,
	beforeLoad: async ({ context }) => {},
});

function RouteComponent() {
	return <Outlet />;
}
