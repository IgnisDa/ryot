import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	useFormatters,
	usePageRefreshRequest,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { ChipButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useEffect } from "react";

import type { EntitySyncFields } from "../../shared/entity-selections";
import { type MediaText, useMediaMessages } from "../messages";
import { useMediaEnrichment } from "./enrichment";

const active = (state: string) => state === "queued" || state === "running" || state === "retrying";

const refreshLabel = (text: MediaText, state: string) => {
	if (state === "queued") {
		return { visible: text("refresh.queued"), accessible: text("refresh.queued-label") };
	}
	if (state === "retrying") {
		return { visible: text("refresh.retrying"), accessible: text("refresh.retrying-label") };
	}
	if (state === "running") {
		return { visible: text("refresh.running"), accessible: text("refresh.running-label") };
	}
	return { visible: text("common.action.refresh"), accessible: text("refresh.idle-label") };
};

export function MediaProviderRefreshControl({
	media,
}: {
	readonly media: EntitySyncFields & {
		readonly id: string;
		readonly providerCheckedAt?: null | string;
	};
}) {
	const formatters = useFormatters();
	const text = useMediaMessages();
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
	if (media.relatedPopulationStatus.availability === "none") {
		return null;
	}
	const label = refreshLabel(text, state);
	return (
		<>
			<ChipButton
				onClick={refresh.submit}
				aria-label={label.accessible}
				disabled={busy || refresh.isPending}
				icon={<AppIcon size={13} name="rotate-ccw" />}
				title={
					media.providerCheckedAt === null || media.providerCheckedAt === undefined
						? undefined
						: text("refresh.last-checked", {
								time: formatters
									.dateTime({ timeStyle: "short", dateStyle: "medium" })
									.format(new Date(media.providerCheckedAt)),
							})
				}
			>
				{label.visible}
			</ChipButton>
			{refresh.error ? (
				<span role="alert" className="text-xs text-danger">
					{text("refresh.failed")}
				</span>
			) : null}
		</>
	);
}
