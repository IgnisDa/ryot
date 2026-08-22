import { createFileRoute, redirect } from "@tanstack/react-router";

import { decideRootGate } from "../modules/server/route-gates";
import { getServerSelection } from "../persistence/storage";

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		const decision = decideRootGate(getServerSelection());
		return redirect({ to: decision.to, search: { redirect: undefined } });
	},
});
