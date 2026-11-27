import { useDisplayText } from "@ryot-app/plugin-client-sdk/react";
import { formatDuration } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

import type { PlatformReleaseList, TimeToBeatValue } from "../../shared/video-game";
import { formatDateOnlyLabel } from "../media/date";
import { MediaFactRow, MediaLabeledRows, MediaOverviewSection } from "../media/primitives";
import type { MediaSummaryFact } from "../media/summary-state";
import { type MediaCopy, useMediaCopy } from "../messages";

type VideoGameOverviewSummary = {
	readonly timeToBeat: TimeToBeatValue;
	readonly platformReleases: PlatformReleaseList;
};

const TIME_TO_BEAT_PACES = ["hastily", "normally", "completely"] as const;

export const videoGameTimeToBeatFacts = (
	{ text, formatters }: MediaCopy,
	timeToBeat: TimeToBeatValue,
): readonly MediaSummaryFact[] =>
	TIME_TO_BEAT_PACES.flatMap((key) => {
		const minutes = timeToBeat?.[key];
		return minutes === undefined || minutes === null
			? []
			: [
					{
						icon: "hourglass",
						label: text("video-game.pace", { pace: key }),
						value: formatDuration(formatters, minutes * 60, "minute"),
					},
				];
	});

export function VideoGameTimeToBeatSection(props: {
	readonly compact: boolean;
	readonly timeToBeat: TimeToBeatValue;
}) {
	const copy = useMediaCopy();
	const facts = videoGameTimeToBeatFacts(copy, props.timeToBeat);
	if (facts.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection title={copy.text("video-game.time-to-beat")}>
			<MediaFactRow facts={facts} compact={props.compact} />
		</MediaOverviewSection>
	);
}

export function VideoGamePlatformsSection(props: {
	readonly platformReleases: PlatformReleaseList;
}) {
	const { text, formatters } = useMediaCopy();
	const displayText = useDisplayText();
	const releases = [...(props.platformReleases ?? [])].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
	if (releases.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection title={text("video-game.platforms")}>
			<MediaLabeledRows
				rows={releases.map((release) => {
					const releaseDate = release.releaseDate ?? undefined;
					const date =
						releaseDate === undefined ? undefined : formatDateOnlyLabel(formatters, releaseDate);
					const region = release.releaseRegion ?? undefined;
					const detail =
						date !== undefined && region !== undefined
							? text("video-game.release-date-region", { date, region })
							: (date ?? region ?? "");
					return {
						detail: displayText(detail),
						key: `${release.name}:${detail}`,
						title: displayText(release.name),
					};
				})}
			/>
		</MediaOverviewSection>
	);
}

export const videoGameOverviewTrailing = (input: {
	readonly compact: boolean;
	readonly summary: VideoGameOverviewSummary;
}): ReactNode => {
	const { compact, summary } = input;
	return (
		<>
			<VideoGameTimeToBeatSection compact={compact} timeToBeat={summary.timeToBeat} />
			<VideoGamePlatformsSection platformReleases={summary.platformReleases} />
		</>
	);
};
