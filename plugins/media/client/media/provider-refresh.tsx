import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePageRefreshRequest, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useEffect } from "react";

import { useMediaEnrichment } from "./enrichment";
import type { MediaEntitySummaryValue } from "./summary-state";

const active = (state: string) => state === "queued" || state === "running" || state === "retrying";

const refreshLabel = (state: string) => {
	if (state === "queued") {
		return "Refresh queued";
	}
	if (state === "retrying") {
		return "Retrying provider refresh";
	}
	if (state === "running") {
		return "Refreshing provider data";
	}
	return "Refresh provider data";
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
	return (
		<div className="grid gap-2">
			<div className="flex flex-wrap items-center gap-3">
				<Button variant="secondary" onClick={refresh.submit} disabled={busy || refresh.isPending}>
					{refreshLabel(state)}
				</Button>
				{media.providerCheckedAt === null ? null : (
					<span className="text-xs text-text-muted">
						Last checked: {new Date(media.providerCheckedAt).toLocaleString()}
					</span>
				)}
			</div>
			{refresh.error ? (
				<StatusMessage
					tone="error"
					action={{ label: "Try again", onClick: refresh.submit, disabled: refresh.isPending }}
				>
					Could not request a provider refresh.
				</StatusMessage>
			) : null}
		</div>
	);
}
