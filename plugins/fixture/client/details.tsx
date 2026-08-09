import { usePluginParams, usePluginSearch } from "@ryot-app/client-sdk/plugin";
import { useRyot } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";

export const Details = () => {
	const ryot = useRyot();
	const { itemId } = usePluginParams();
	const tab = usePluginSearch().get("tab");

	return (
		<main className="flex min-h-screen w-full flex-col items-center gap-4 bg-bg p-8 text-text">
			<h1 className="font-display text-2xl">Item details</h1>
			<p className="text-text-muted">
				Item {itemId}, tab {tab}.
			</p>
			<Button onClick={() => ryot.navigation.replace({ path: "/" })}>Back</Button>
		</main>
	);
};
