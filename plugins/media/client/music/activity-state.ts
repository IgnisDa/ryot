import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { MusicActivityResult } from "../../shared/music-recipes";
import type { MediaActivityState } from "../media/activity-tab";
import { decimalLabel, type MediaActivityReviewRow } from "../media/activity-timeline";
import {
	mediaFlatActivityView,
	type MediaFlatActivityBeat,
	type MediaFlatActivityRow,
	type MediaFlatActivitySummary,
	type MediaFlatActivityTimeline,
	type MediaFlatActivityView,
} from "../media/flat-activity-state";
import { classifyRyotQueryResult } from "../media/query-state";

type MusicReviewSubject = { readonly on: "music" };

const MUSIC_REVIEW_SUBJECT: MusicReviewSubject = { on: "music" };

export type MusicActivityReviewRow = MediaActivityReviewRow<MusicReviewSubject>;

export type MusicActivityRow = MediaFlatActivityRow<MusicReviewSubject>;

export type MusicActivityTimeline = MediaFlatActivityTimeline<MusicReviewSubject>;

export type MusicActivitySummary = MediaFlatActivitySummary;

export type MusicActivityView = MediaFlatActivityView<MusicReviewSubject>;

export type MusicActivityState = MediaActivityState<MusicActivityView>;

export const musicActivityView = (result: MusicActivityResult) =>
	mediaFlatActivityView({
		events: result.events,
		truncated: result.truncated,
		subject: MUSIC_REVIEW_SUBJECT,
		completions: result.completionCount,
		minutes: { total: result.consumedMinutes ?? 0, missing: result.unknownDurationCount },
	});

export const mapMusicActivity = (
	result: RyotQueryResult<MusicActivityResult>,
): MusicActivityState => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const view = musicActivityView(state.value);
	return view === undefined ? { status: "empty" } : { view, status: "ready" };
};

const BEAT_LABELS: Record<MediaFlatActivityBeat, string> = {
	backlog: "Added to backlog",
	dropped: "Stopped listening",
	on_hold: "Put this track on hold",
};

export const musicActivityRowLabel = (row: MusicActivityRow): string => {
	if (row.type === "completion") {
		return "Finished the track";
	}
	if (row.type === "collection") {
		return row.change === "added"
			? `Added to the ${row.name} collection`
			: `Removed from the ${row.name} collection`;
	}
	if (row.type === "beat") {
		return BEAT_LABELS[row.beat];
	}
	if (row.type === "progress") {
		return row.percent === undefined
			? "Part-way through the track"
			: `${decimalLabel(row.percent)}% through the track`;
	}
	return "Reviewed the track";
};

export const musicActivityListensLabel = (summary: MusicActivitySummary) =>
	`${summary.completions}`;
