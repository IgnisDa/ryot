import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/instance-admin/")({
	beforeLoad: () => {
		// oxlint-disable-next-line typescript/only-throw-error
		throw redirect({ replace: true, to: "/instance-admin/users" });
	},
});
