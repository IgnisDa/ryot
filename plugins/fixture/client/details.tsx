import { usePluginParams, usePluginSearch, PluginPackageId } from "@ryot-app/client-sdk/plugin";
import { usePluginIdentity, useRyot } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button } from "@ryot-app/client-ui-sdk";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { fixtureRoute } from "./targets";

export const Details = () => {
	const identity = usePluginIdentity(PluginPackageId.make(PLUGIN_PACKAGE_ID));
	const ryot = useRyot();
	const { itemId } = usePluginParams();
	const tab = usePluginSearch().get("tab");

	return (
		<PluginScreenFrame title={`Item ${itemId}`}>
			<div className="flex w-full flex-col items-center gap-4 text-text">
				<p className="text-text-muted">
					Item {itemId}, tab {tab}.
				</p>
				<Button onClick={() => ryot.navigation.replace(fixtureRoute(identity.pluginId, "/"))}>
					Back
				</Button>
			</div>
		</PluginScreenFrame>
	);
};

export default Details;
