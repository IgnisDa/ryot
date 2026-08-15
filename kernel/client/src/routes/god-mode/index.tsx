import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/god-mode/")({
	beforeLoad: () => {
		// oxlint-disable-next-line typescript/only-throw-error
		throw redirect({ replace: true, to: "/god-mode/users" });
	},
});
