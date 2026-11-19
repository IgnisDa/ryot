import { usePluginParams, usePluginSearch } from "@ryot-app/plugin-client-sdk/plugin";
import { useMessages, useRyot, useStampedMessages } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button } from "@ryot-app/plugin-ui-sdk";

import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { fixtureRoute } from "./targets";

export const Details = () => {
	const ryot = useRyot();
	const itemId = usePluginParams().itemId ?? "";
	const tab = usePluginSearch().get("tab");
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	const message = useStampedMessages(PLUGIN_PACKAGE_ID, catalogMessage);

	return (
		<PluginScreenFrame title={message("details.title", { itemId })}>
			<div className="flex w-full flex-col items-center gap-4 text-text">
				<p className="text-text-muted">{text("details.summary", { itemId, tab: tab ?? "" })}</p>
				<Button onClick={() => ryot.navigation.replace(fixtureRoute("/"))}>
					{text("common.action.back")}
				</Button>
			</div>
		</PluginScreenFrame>
	);
};

export default Details;
