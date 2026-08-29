import { usePluginParams, usePluginSearch } from "@ryot-app/client-sdk/plugin";
import { useRyot } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button } from "@ryot-app/client-ui-sdk";

export const Details = () => {
	const ryot = useRyot();
	const { itemId } = usePluginParams();
	const tab = usePluginSearch().get("tab");

	return (
		<PluginScreenFrame title={`Item ${itemId}`}>
			<div className="flex w-full flex-col items-center gap-4 text-text">
				<p className="text-text-muted">
					Item {itemId}, tab {tab}.
				</p>
				<Button onClick={() => ryot.navigation.replace({ kind: "route", path: "/" })}>Back</Button>
			</div>
		</PluginScreenFrame>
	);
};
