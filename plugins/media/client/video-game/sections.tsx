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
	{ key: "hastily", label: "Hastily" },
	{ key: "normally", label: "Normally" },
	{ key: "completely", label: "Completely" },
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
	readonly divided: boolean;
	readonly timeToBeat: TimeToBeatValue;
}) {
	const facts = videoGameTimeToBeatFacts(props.timeToBeat);
	if (facts.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection divided={props.divided} compact={props.compact} title="How long to beat">
			<MediaFactRow facts={facts} compact={props.compact} />
		</MediaOverviewSection>
	);
}

export function VideoGamePlatformsSection(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly platformReleases: PlatformReleaseList;
}) {
	const releases = [...(props.platformReleases ?? [])].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
	if (releases.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection title="Platforms" divided={props.divided} compact={props.compact}>
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
	readonly divided: boolean;
	readonly summary: VideoGameOverviewSummary;
}): ReactNode => {
	const { compact, divided, summary } = input;
	const hasTimeToBeat = videoGameTimeToBeatFacts(summary.timeToBeat).length > 0;
	return (
		<>
			<VideoGameTimeToBeatSection
				compact={compact}
				divided={divided}
				timeToBeat={summary.timeToBeat}
			/>
			<VideoGamePlatformsSection
				compact={compact}
				divided={divided || hasTimeToBeat}
				platformReleases={summary.platformReleases}
			/>
		</>
	);
};
