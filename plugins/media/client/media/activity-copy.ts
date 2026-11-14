import type { MediaPosition } from "../../shared/consumption";
import type { ListStateProperties } from "../../shared/list-state";
import type { MediaReviewOccurrence } from "../../shared/review-link-recipes";
import { capitalized } from "./activity-log/state";
import { decimalLabel, type MediaActivityProgressRun } from "./activity-timeline";
import { formatDateOnlyLabel, formatLocalDateLabel } from "./date";

type MediaActivityVerb = "read" | "play" | "watch" | "listen";

const MEDIA_LIST_STATE_LABELS: Record<ListStateProperties["state"], string> = {
	backlog: "Backlog",
	dropped: "Dropped",
	on_hold: "On hold",
	complete: "Complete",
	in_progress: "In progress",
};

const MEDIA_POSITION_LABELS: Record<MediaPosition["unit"], string> = {
	episodes: "Ep",
	chapters: "Ch",
	volumes: "Vol",
};

export const mediaPositionLabel = (position: MediaPosition) =>
	[
		`${MEDIA_POSITION_LABELS[position.unit]} ${decimalLabel(position.position)}`,
		...(position.volume === undefined ? [] : [`Vol ${decimalLabel(position.volume)}`]),
	].join(" · ");

export const mediaListStateDetail = ({
	listState,
}: {
	readonly listState: null | ListStateProperties;
}) =>
	listState === null
		? undefined
		: [
				MEDIA_LIST_STATE_LABELS[listState.state],
				...(listState.position === undefined ? [] : [mediaPositionLabel(listState.position)]),
				`Repeat count ${listState.repeatCount}`,
			].join(" · ");

type MediaActivityVerbCopy = {
	readonly object: string;
	readonly gerund: string;
	readonly participle: string;
	readonly segmentNoun: string;
	readonly recordLabel: string;
	readonly completionsLabel: string;
};

const MEDIA_ACTIVITY_VERBS: Record<MediaActivityVerb, MediaActivityVerbCopy> = {
	read: {
		object: "read",
		gerund: "reading",
		participle: "read",
		segmentNoun: "Read",
		completionsLabel: "Reads",
		recordLabel: "Reading record",
	},
	play: {
		object: "play",
		gerund: "playing",
		segmentNoun: "Play",
		participle: "played",
		recordLabel: "Play record",
		completionsLabel: "Playthroughs",
	},
	watch: {
		object: "watch",
		gerund: "watching",
		segmentNoun: "Watch",
		participle: "watched",
		recordLabel: "Watch record",
		completionsLabel: "Watches",
	},
	listen: {
		object: "listen to",
		gerund: "listening",
		segmentNoun: "Listen",
		participle: "listened",
		completionsLabel: "Listens",
		recordLabel: "Listen record",
	},
};

const mediaActivityCopy = (verb: MediaActivityVerbCopy, noun: string) => ({
	segmentNoun: verb.segmentNoun,
	recordLabel: verb.recordLabel,
	libraryLabel: "Added to media library",
	loadingDetail: `Fetching everything you have recorded for this ${noun}.`,
	rowLabels: { review: `Reviewed the ${noun}`, completion: `Finished the ${noun}` },
	emptyDetail: `Nothing has been recorded for this ${noun}. Whatever you ${verb.object} will appear here as your ${verb.recordLabel.toLowerCase()}.`,
});

const mediaActivityBeats = (verb: MediaActivityVerbCopy, noun: string) => ({
	dropped: `Stopped ${verb.gerund}`,
	on_hold: `Put this ${noun} on hold`,
});

export const mediaFlatActivityCopy = <Extra = unknown>(input: {
	readonly noun: string;
	readonly verb: MediaActivityVerb;
	readonly progress?: (percent: string | undefined, extra: Extra) => string;
	readonly snapshot?: {
		readonly label: string;
		readonly detail: (extra: Extra) => string | undefined;
	};
}) => {
	const verb = MEDIA_ACTIVITY_VERBS[input.verb];
	const { rowLabels, ...copy } = mediaActivityCopy(verb, input.noun);
	const progress: (percent: string | undefined, extra: Extra) => string =
		input.progress ??
		((percent) =>
			percent === undefined
				? `Part-way through the ${input.noun}`
				: `${percent}% through the ${input.noun}`);
	return {
		...copy,
		progressVerb: verb.participle,
		rowLabels: { ...rowLabels, progress },
		completionsLabel: verb.completionsLabel,
		beats: mediaActivityBeats(verb, input.noun),
		snapshot: input.snapshot ?? { label: "Synced", detail: () => undefined },
		itemLabel: (item: MediaPosition) =>
			`${capitalized(verb.participle)} ${mediaPositionLabel(item)}`,
	};
};

export const mediaEpisodicActivityCopy = (input: {
	readonly noun: string;
	readonly watchedLabel: string;
	readonly verb: MediaActivityVerb;
}) => {
	const verb = MEDIA_ACTIVITY_VERBS[input.verb];
	const { rowLabels, ...copy } = mediaActivityCopy(verb, input.noun);
	return {
		...copy,
		rowLabels: { ...rowLabels, watched: input.watchedLabel },
		beats: { ...mediaActivityBeats(verb, input.noun), backlog: "Added to backlog" },
		figures: {
			time: "Time",
			episodes: "Episodes",
			current: `This ${verb.segmentNoun.toLowerCase()}`,
			watches: `Completed ${verb.completionsLabel.toLowerCase()}`,
		},
	};
};

export const mediaReviewActivityCopy = (noun: string) => ({
	segmentNoun: "Activity",
	recordLabel: "Activity record",
	libraryLabel: "Added to media library",
	rowLabels: { review: `Reviewed this ${noun}` },
	loadingDetail: `Fetching everything you have recorded for this ${noun}.`,
	emptyDetail: `Nothing has been recorded for this ${noun}. Your reviews, media library changes and collection changes will appear here.`,
});

export const mediaActivityRunLabel = (run: MediaActivityProgressRun) =>
	run.fromPercent === undefined
		? `${run.updates} updates`
		: `${run.updates} updates since ${decimalLabel(run.fromPercent)}%`;

export const mediaActivityExpandLabel = (input: {
	readonly count: number;
	readonly expanded: boolean;
}) => (input.expanded ? "Hide episodes" : `Show ${input.count} episodes`);

const occurrenceDateLabel = (occurrence: MediaReviewOccurrence) => {
	if (occurrence.dateUnknown === true) {
		return undefined;
	}
	return occurrence.calendarDate === null
		? formatLocalDateLabel(occurrence.occurredAt)
		: formatDateOnlyLabel(occurrence.calendarDate);
};

const datedLabel = (label: string, occurrence: MediaReviewOccurrence, separator: string) => {
	const date = occurrenceDateLabel(occurrence);
	return date === undefined ? label : `${label}${separator}${date}`;
};

/** What a linked review is about, in the schema's activity vocabulary: "About your watch on Nov 3, 2026". */
export const mediaReviewOccurrenceLabel = (
	segmentNoun: string,
	occurrence: MediaReviewOccurrence,
) => {
	const noun = segmentNoun.toLowerCase();
	const subjects: Record<MediaReviewOccurrence["eventSchemaSlug"], string> = {
		dropped: "stopping",
		complete: `your ${noun}`,
		progress: "your progress",
		on_hold: "putting it on hold",
		"item-complete":
			occurrence.position === null
				? `your ${noun}`
				: `your ${noun} of ${mediaPositionLabel(occurrence.position)}`,
	};
	return datedLabel(`About ${subjects[occurrence.eventSchemaSlug]}`, occurrence, " on ");
};

/** A choice in the review composer's "About" select: "Finished · Nov 3, 2026". */
export const mediaReviewOccurrenceChoiceLabel = (occurrence: MediaReviewOccurrence) => {
	const position =
		occurrence.position === null ? "" : ` ${mediaPositionLabel(occurrence.position)}`;
	const kinds: Record<MediaReviewOccurrence["eventSchemaSlug"], string> = {
		dropped: "Dropped",
		on_hold: "On hold",
		complete: "Finished",
		progress: `Progress${position}`,
		"item-complete": `Finished${position}`,
	};
	return datedLabel(kinds[occurrence.eventSchemaSlug], occurrence, " · ");
};
