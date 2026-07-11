import type { MusicSummaryResult } from "../../shared/music-recipes";
import { mediaTrackLengthLabel } from "../media/activity-timeline";
import {
	mediaRatingFact,
	mediaSummaryStateMapper,
	type MediaSummaryFact,
	type MediaSummaryState,
} from "../media/summary-state";

export type MusicSummary = NonNullable<MusicSummaryResult["music"]>;

export type MusicSummaryState = MediaSummaryState<MusicSummary>;

export const MUSIC_TYPE_LABEL = "Music";

const musicSummaryState = mediaSummaryStateMapper<MusicSummaryResult, MusicSummary>({
	plural: "tracks",
	singular: "track",
	title: MUSIC_TYPE_LABEL,
	select: ({ music }) => music,
});

export const mapMusicSummary = musicSummaryState.mapSummary;

export const musicSummaryError = musicSummaryState.summaryError;

export const musicSummaryUnavailable = musicSummaryState.summaryUnavailable;

const MUSIC_LIFECYCLE_LABELS: Record<MusicSummary["state"], string> = {
	on_hold: "On hold",
	dropped: "Dropped",
	complete: "Complete",
	backlog: "In backlog",
	untracked: "Not tracked",
	in_progress: "In progress",
};

export const musicLifecycleLabel = (state: MusicSummary["state"]) => MUSIC_LIFECYCLE_LABELS[state];

export const musicDurationFact = (music: Pick<MusicSummary, "duration">) =>
	music.duration === null
		? undefined
		: { icon: "clock", label: "Length", value: mediaTrackLengthLabel(music.duration) };

export const musicSummaryFacts = (music: MusicSummary): readonly MediaSummaryFact[] =>
	[
		mediaRatingFact(music),
		musicDurationFact(music),
		music.byVariousArtists === null
			? undefined
			: { icon: "users", label: "Various artists", value: music.byVariousArtists ? "Yes" : "No" },
		music.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: music.productionStatus },
	].filter((fact) => fact !== undefined);

export const musicSummaryProgress = (music: MusicSummary) =>
	music.state === "in_progress" && music.progressPercent !== null
		? { percent: music.progressPercent }
		: undefined;
