import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePageRefreshRequest, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { ChipButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useEffect } from "react";

import { useMediaEnrichment } from "./enrichment";
import type { MediaEntitySummaryValue } from "./summary-state";

const active = (state: string) => state === "queued" || state === "running" || state === "retrying";

const refreshLabel = (state: string) => {
	if (state === "queued") {
		return { visible: "Queued", accessible: "Refresh queued" };
	}
	if (state === "retrying") {
		return { visible: "Retrying", accessible: "Retrying provider refresh" };
	}
	if (state === "running") {
		return { visible: "Refreshing", accessible: "Refreshing provider data" };
	}
	return { visible: "Refresh", accessible: "Refresh provider data" };
};

export function MediaProviderRefreshControl({
	media,
}: {
	readonly media: MediaEntitySummaryValue;
}) {
	const refresh = useMediaEnrichment(media.id, "population", "refresh");
	const schedule = useRyotSchedule();
	const refreshPage = usePageRefreshRequest();
	const state = active(media.relatedPopulationStatus.state)
		? media.relatedPopulationStatus.state
		: media.populationStatus.state;
	const busy = active(state);
	useEffect(() => {
		if (!busy && !active(media.translationStatus.state)) {
			return undefined;
		}
		return schedule.run(
			Effect.forever(Effect.andThen(Effect.sleep("5 seconds"), Effect.sync(refreshPage))),
			() => undefined,
		);
	}, [busy, media.translationStatus.state, refreshPage, schedule]);
	if (!media.canRefreshProvider) {
		return null;
	}
	const label = refreshLabel(state);
	return (
		<>
			<ChipButton
				onClick={refresh.submit}
				aria-label={label.accessible}
				disabled={busy || refresh.isPending}
				icon={<AppIcon size={13} name="rotate-ccw" />}
				title={
					media.providerCheckedAt === null
						? undefined
						: `Last checked: ${new Date(media.providerCheckedAt).toLocaleString()}`
				}
			>
				{label.visible}
			</ChipButton>
			{refresh.error ? (
				<span role="alert" className="text-xs text-danger">
					Could not request a provider refresh. Try again.
				</span>
			) : null}
		</>
	);
}
