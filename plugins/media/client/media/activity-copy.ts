import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { formatDateLabel } from "@ryot-app/plugin-ui-sdk/datetime";

import type { MediaPosition } from "../../shared/consumption";
import type { ListStateProperties } from "../../shared/list-state";
import type { MediaReviewOccurrence } from "../../shared/review-link-recipes";
import type { MediaCopy, MediaReviewKind, MediaText, MediaTitleKind } from "../messages";
import type { ActivityVerb } from "./activity-log/state";
import type { MediaActivityProgressRun } from "./activity-timeline";
import { formatDateOnlyLabel } from "./date";

export type MediaActivitySegment = "activity" | ActivityVerb;

export type MediaActivityCopyInput<Extra = unknown> = {
	readonly verb: ActivityVerb;
	readonly kind: MediaTitleKind;
	readonly snapshot?: {
		readonly source: "anilist";
		readonly detail: (copy: MediaCopy, extra: Extra) => string | undefined;
	};
};

type ActivityCopyTarget = { readonly verb: ActivityVerb; readonly kind: MediaTitleKind };

export const mediaPositionLabel = (text: MediaText, position: MediaPosition) =>
	position.volume === undefined
		? text("activity.position", { unit: position.unit, position: position.position })
		: text("activity.position-with-volume", {
				unit: position.unit,
				volume: position.volume,
				position: position.position,
			});

export const mediaListStateDetail = (
	{ text }: MediaCopy,
	{ listState }: { readonly listState: null | ListStateProperties },
) =>
	listState === null
		? undefined
		: [
				text("activity.list-state", { state: listState.state }),
				...(listState.position === undefined ? [] : [mediaPositionLabel(text, listState.position)]),
				text("activity.repeat-count", { count: listState.repeatCount }),
			].join(" · ");

const mediaActivityCopy = (text: MediaText, input: ActivityCopyTarget) => ({
	segment: input.verb,
	loadingDetail: text("activity.loading-detail"),
	libraryLabel: text("event-schema.add-to-media-library.name"),
	emptyDetail: text("activity.empty-detail", { verb: input.verb }),
	recordLabel: text("activity.record-label", { segment: input.verb }),
	rowLabels: {
		review: text("activity.row-review", { kind: input.kind }),
		completion: text("activity.row-completion", { kind: input.kind }),
	},
});

const mediaActivityBeats = (text: MediaText, input: ActivityCopyTarget) => ({
	on_hold: text("activity.beat-on-hold"),
	dropped: text("log.status.detail-dropped", { verb: input.verb }),
});

export type MediaFlatActivityCopy<Extra = unknown> = ReturnType<
	typeof mediaFlatActivityCopy<Extra>
>;

export const mediaFlatActivityCopy = <Extra = unknown>(
	mediaCopy: MediaCopy,
	input: MediaActivityCopyInput<Extra>,
) => {
	const { text } = mediaCopy;
	const { rowLabels, ...copy } = mediaActivityCopy(text, input);
	return {
		...copy,
		beats: mediaActivityBeats(text, input),
		completionsLabel: text("activity.completions-label", { verb: input.verb }),
		progressLabel: (percent: number) =>
			text("activity.progress-verb", { verb: input.verb, percent: percent / 100 }),
		itemLabel: (item: MediaPosition) =>
			text("activity.item-label", { verb: input.verb, position: mediaPositionLabel(text, item) }),
		snapshot: {
			detail: (extra: Extra) => input.snapshot?.detail(mediaCopy, extra),
			label:
				input.snapshot === undefined
					? text("activity.synced")
					: text("activity.synced-from-anilist"),
		},
		rowLabels: {
			...rowLabels,
			progress: (percent: number | undefined, _extra: Extra) =>
				percent === undefined
					? text("activity.progress-unknown")
					: text("activity.progress-percent", { percent: percent / 100 }),
		},
	};
};

export const mediaEpisodicActivityCopy = (
	text: MediaText,
	input: ActivityCopyTarget & { readonly watched: "played" | "watched" },
) => {
	const { rowLabels, ...copy } = mediaActivityCopy(text, input);
	return {
		...copy,
		rowLabels: { ...rowLabels, watched: input.watched },
		beats: { ...mediaActivityBeats(text, input), backlog: text("activity.beat-backlog") },
		figures: {
			time: text("activity.figure-time"),
			episodes: text("property.episodes"),
			current: text("activity.figure-current", { verb: input.verb }),
			watches: text("activity.figure-completed", { verb: input.verb }),
		},
	};
};

export const mediaReviewActivityCopy = (text: MediaText, kind: MediaReviewKind) => ({
	segment: "activity" as const,
	loadingDetail: text("activity.loading-detail"),
	emptyDetail: text("activity.empty-detail-review"),
	libraryLabel: text("event-schema.add-to-media-library.name"),
	rowLabels: { review: text("activity.row-review-this", { kind }) },
	recordLabel: text("activity.record-label", { segment: "activity" }),
});

export const mediaActivityRunLabel = ({ text }: MediaCopy, run: MediaActivityProgressRun) =>
	run.fromPercent === undefined
		? text("activity.run", { count: run.updates })
		: text("activity.run-since", { count: run.updates, percent: run.fromPercent / 100 });

export const mediaActivityExpandLabel = (
	text: MediaText,
	input: { readonly count: number; readonly expanded: boolean },
) =>
	input.expanded
		? text("activity.expand-hide")
		: text("activity.expand-show", { count: input.count });

const occurrenceDateLabel = ({ formatters }: MediaCopy, occurrence: MediaReviewOccurrence) => {
	if (occurrence.dateUnknown === true) {
		return undefined;
	}
	return occurrence.calendarDate === null
		? formatDateLabel(formatters, occurrence.occurredAt)
		: formatDateOnlyLabel(formatters, occurrence.calendarDate);
};

const reviewKind = (occurrence: MediaReviewOccurrence) => {
	if (occurrence.eventSchemaSlug === "item-complete") {
		return occurrence.position === null ? "item_complete" : "item_complete_at";
	}
	return occurrence.eventSchemaSlug;
};

/** What a linked review is about, in the schema's activity vocabulary: "About your watch on Nov 3, 2026". */
export const mediaReviewOccurrenceLabel = (
	copy: MediaCopy,
	segment: MediaActivitySegment,
	occurrence: MediaReviewOccurrence,
) => {
	const { text } = copy;
	const about = {
		segment,
		kind: reviewKind(occurrence),
		position: occurrence.position === null ? "" : mediaPositionLabel(text, occurrence.position),
	} as const;
	const date = occurrenceDateLabel(copy, occurrence);
	return date === undefined
		? text("activity.review-about", about)
		: text("activity.review-about-dated", { ...about, date });
};

/** A choice in the review composer's "About" select: "Finished · Nov 3, 2026". */
export const mediaReviewOccurrenceChoiceLabel = (
	copy: MediaCopy,
	occurrence: MediaReviewOccurrence,
) => {
	const { text } = copy;
	const { position, eventSchemaSlug: slug } = occurrence;
	let choice: Text;
	if (position !== null && slug === "progress") {
		choice = text("activity.review-choice-positioned", {
			kind: "progress",
			position: mediaPositionLabel(text, position),
		});
	} else if (position !== null && slug === "item-complete") {
		choice = text("activity.review-choice-positioned", {
			kind: "item_complete",
			position: mediaPositionLabel(text, position),
		});
	} else {
		choice = text("activity.review-choice", {
			kind: slug === "item-complete" ? "item_complete" : slug,
		});
	}
	const date = occurrenceDateLabel(copy, occurrence);
	return date === undefined ? choice : text("activity.review-choice-dated", { date, choice });
};
