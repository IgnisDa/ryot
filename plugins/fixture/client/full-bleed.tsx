import { usePluginTitle, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { useMessages, useRyot, useStampedMessages } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";

import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { fixtureRoute } from "./targets";

export const FullBleed = () => {
	const ryot = useRyot();
	const { safeAreaTop } = useRyotViewport();
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	const message = useStampedMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	usePluginTitle(message("full-bleed.title"));

	return (
		<main className="min-h-full w-full bg-bg text-text">
			<div
				style={{ paddingTop: safeAreaTop }}
				className="flex flex-col items-center gap-2 bg-accent-soft px-4 pb-6"
			>
				<p data-testid="fixture-safe-area" className="pt-4 text-sm text-text-muted">
					{text("full-bleed.safe-area-inset", { inset: safeAreaTop })}
				</p>
				<h1 className="font-display text-2xl">{text("full-bleed.heading")}</h1>
			</div>
			<div className="flex flex-col items-center gap-4 px-4 py-6">
				<p className="max-w-md text-center text-text-muted">{text("full-bleed.description")}</p>
				<Button onClick={() => ryot.navigation.replace(fixtureRoute("/"))}>
					{text("full-bleed.back-home")}
				</Button>
			</div>
		</main>
	);
};

export default FullBleed;
