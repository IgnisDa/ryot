import { usePluginNavigation, usePluginParams, usePluginSearch } from "@ryot/client-plugin-sdk";
import { Button } from "@ryot/client-ui-sdk";

export const Details = () => {
	const { itemId } = usePluginParams();
	const tab = usePluginSearch().get("tab");
	const { replace } = usePluginNavigation();

	return (
		<main className="flex flex-col items-center gap-4 p-8 text-text">
			<h1 className="font-display text-2xl">Item details</h1>
			<p className="text-text-muted">
				Item {itemId}, tab {tab}.
			</p>
			<Button onClick={() => replace({ path: "/" })}>Back</Button>
		</main>
	);
};
