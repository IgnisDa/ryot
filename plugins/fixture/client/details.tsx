import { usePluginParams, usePluginSearch } from "@ryot/client-sdk/plugin";
import { useRyot } from "@ryot/client-sdk/react";
import { Button } from "@ryot/client-ui-sdk";
import { useEffect } from "react";

export const Details = () => {
	const ryot = useRyot();
	const { itemId } = usePluginParams();
	const tab = usePluginSearch().get("tab");

	useEffect(() => ryot.header.set({ title: `Item ${itemId}` }), [itemId, ryot]);

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
