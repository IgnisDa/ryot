import type { ReactNode } from "react";

import type { PlatformReleaseList, TimeToBeatValue } from "../../shared/video-game";
import { mediaActivityDurationLabel } from "../media/activity-timeline";
import { formatDateOnlyLabel } from "../media/date";
import { MediaFactRow, MediaLabeledRows, MediaOverviewSection } from "../media/primitives";
import type { MediaSummaryFact } from "../media/summary-state";

type VideoGameOverviewSummary = {
	readonly timeToBeat: TimeToBeatValue;
	readonly platformReleases: PlatformReleaseList;
};

const TIME_TO_BEAT_PACES = [
	{ key: "hastily", label: "Rushed" },
	{ key: "normally", label: "Main story" },
	{ key: "completely", label: "Completionist" },
] as const;

export const videoGameTimeToBeatFacts = (
	timeToBeat: TimeToBeatValue,
): readonly MediaSummaryFact[] =>
	TIME_TO_BEAT_PACES.flatMap(({ key, label }) => {
		const minutes = timeToBeat?.[key];
		return minutes === undefined || minutes === null
			? []
			: [{ label, icon: "hourglass", value: mediaActivityDurationLabel(minutes) }];
	});

export function VideoGameTimeToBeatSection(props: {
	readonly compact: boolean;
	readonly timeToBeat: TimeToBeatValue;
}) {
	const facts = videoGameTimeToBeatFacts(props.timeToBeat);
	if (facts.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection title="How long to beat">
			<MediaFactRow facts={facts} compact={props.compact} />
		</MediaOverviewSection>
	);
}

export function VideoGamePlatformsSection(props: {
	readonly platformReleases: PlatformReleaseList;
}) {
	const releases = [...(props.platformReleases ?? [])].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
	if (releases.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection title="Platforms">
			<MediaLabeledRows
				rows={releases.map((release) => {
					const releaseDate = release.releaseDate ?? undefined;
					const detail = [
						releaseDate === undefined ? undefined : formatDateOnlyLabel(releaseDate),
						release.releaseRegion ?? undefined,
					]
						.filter((part) => part !== undefined)
						.join(" · ");
					return { detail, title: release.name, key: `${release.name}:${detail}` };
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
