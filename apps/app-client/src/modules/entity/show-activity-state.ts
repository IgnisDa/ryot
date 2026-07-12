import type {
	ShowActivityEpisode,
	ShowActivityEvent,
	ShowActivityResult,
} from "@ryot/media-plugin/query-recipes";
import { Match } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";

import { classifyRyotQLResult, type MappedRyotQLResultState } from "@/api/ryotql";
import {
	formatLocalDateKey,
	formatLocalDateLabel,
	formatLocalMonthDayLabel,
	formatLocalYearLabel,
} from "@/modules/ui/date";
import { collectManagedAssetLocators } from "@/modules/ui/managed-assets";

import { preferredMediaImageAsset } from "./media-image";
import { optionalText, showEpisodeOriginLabel } from "./show-episodes-state";

type ParentActivityEvent = Extract<ShowActivityEvent, { kind: "parent" }>;
type EpisodeActivityEvent = Extract<ShowActivityEvent, { kind: "episode" }>;
type CollectionActivityEvent = Extract<ShowActivityEvent, { kind: "collection" }>;

export type ShowActivityFact = { readonly label: string; readonly value: string };

export type ShowActivityDay = {
	readonly key: string;
	readonly label: string;
	readonly entries: readonly ShowActivityEvent[];
};

export type ShowActivityCycle = {
	readonly key: string;
	readonly heading: string | undefined;
	readonly days: readonly ShowActivityDay[];
};

export type ShowActivityJournal = {
	readonly truncated: boolean;
	readonly facts: readonly ShowActivityFact[];
	readonly cycles: readonly ShowActivityCycle[];
};

export type ShowActivityState = MappedRyotQLResultState<
	{ readonly status: "empty" } | { readonly status: "ready"; readonly journal: ShowActivityJournal }
>;

type ShowActivityFailure = Pick<
	Extract<ShowActivityState, { status: "transport-error" | "malformed" }>,
	"status"
>;

type ViewingCycle = {
	readonly completedAt: string | null;
	readonly events: readonly ShowActivityEvent[];
};

const decimalLabel = (value: number) => String(Math.round(value * 100) / 100);

const isParentCompletion = (event: ShowActivityEvent) =>
	event.kind === "parent" && event.eventSchemaSlug === "complete";

export const showActivityViewingCycles = (
	events: readonly ShowActivityEvent[],
): readonly ViewingCycle[] => {
	const cycles: ViewingCycle[] = [];
	let open: { completedAt: string | null; events: ShowActivityEvent[] } = {
		events: [],
		completedAt: null,
	};
	for (const event of events) {
		if (!isParentCompletion(event)) {
			open.events.push(event);
			continue;
		}
		if (open.events.length > 0) {
			cycles.push(open);
		}
		open = { events: [event], completedAt: event.occurredAt };
	}
	return open.events.length > 0 ? [...cycles, open] : cycles;
};

export const showActivityMilestones = (events: readonly ShowActivityEvent[]) => {
	const completed = new Set<string>();
	const collapsed = new Set<string>();
	return events.filter((event) => {
		if (event.kind !== "episode") {
			return true;
		}
		if (event.eventSchemaSlug === "complete") {
			completed.add(event.episode.id);
			return true;
		}
		if (event.eventSchemaSlug !== "progress") {
			return true;
		}
		if (completed.has(event.episode.id) || collapsed.has(event.episode.id)) {
			return false;
		}
		collapsed.add(event.episode.id);
		return true;
	});
};

const showActivityDays = (events: readonly ShowActivityEvent[]): readonly ShowActivityDay[] => {
	const days: { key: string; label: string; entries: ShowActivityEvent[] }[] = [];
	for (const event of events) {
		const key = formatLocalDateKey(event.occurredAt);
		const open = days.at(-1);
		if (open?.key === key) {
			open.entries.push(event);
		} else {
			days.push({ key, entries: [event], label: formatLocalDateLabel(event.occurredAt) });
		}
	}
	return days;
};

const consumptionSources = (events: readonly ShowActivityEvent[]) => [
	...new Set(
		events.flatMap((event) => {
			const source = optionalText(event.consumedOn);
			return source === undefined ? [] : [source];
		}),
	),
];

const trackedSpanLabel = (earliest: string, latest: string) => {
	if (formatLocalDateKey(earliest) === formatLocalDateKey(latest)) {
		return formatLocalDateLabel(latest);
	}
	return formatLocalYearLabel(earliest) === formatLocalYearLabel(latest)
		? `${formatLocalMonthDayLabel(earliest)} – ${formatLocalDateLabel(latest)}`
		: `${formatLocalDateLabel(earliest)} – ${formatLocalDateLabel(latest)}`;
};

const trackedSpanFact = (
	events: readonly ShowActivityEvent[],
	truncated: boolean,
): ShowActivityFact | undefined => {
	const latest = events.at(0);
	const earliest = events.at(-1);
	if (latest === undefined || earliest === undefined) {
		return undefined;
	}
	if (truncated) {
		return { label: "Latest activity", value: formatLocalDateLabel(latest.occurredAt) };
	}
	return { label: "Tracked", value: trackedSpanLabel(earliest.occurredAt, latest.occurredAt) };
};

const showActivityFacts = (result: ShowActivityResult): readonly ShowActivityFact[] => {
	const sources = consumptionSources(result.events);
	const completions = result.events.filter(isParentCompletion).length;
	return [
		trackedSpanFact(result.events, result.truncated),
		result.truncated || completions === 0
			? undefined
			: { label: "Completed watches", value: String(completions) },
		sources.length === 0 ? undefined : { label: "Watched on", value: sources.join(", ") },
	].filter((fact) => fact !== undefined);
};

const cycleHeading = (cycle: ViewingCycle, hasCompletedCycle: boolean) => {
	if (cycle.completedAt !== null) {
		return `Completed ${formatLocalDateLabel(cycle.completedAt)}`;
	}
	return hasCompletedCycle ? "Current watch" : undefined;
};

export const showActivityJournal = (result: ShowActivityResult): ShowActivityJournal => {
	const cycles = showActivityViewingCycles(result.events);
	const hasCompletedCycle = cycles.some((cycle) => cycle.completedAt !== null);
	return {
		truncated: result.truncated,
		facts: showActivityFacts(result),
		cycles: cycles
			.map((cycle, index) => ({
				key: cycle.completedAt ?? `current-${index}`,
				heading: cycleHeading(cycle, hasCompletedCycle),
				days: showActivityDays(showActivityMilestones(cycle.events)),
			}))
			.filter((cycle) => cycle.days.length > 0),
	};
};

export const mapShowActivity = (
	result: AsyncResult.AsyncResult<ShowActivityResult, unknown>,
): ShowActivityState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const journal = showActivityJournal(state.value);
	return journal.cycles.length === 0 ? { status: "empty" } : { status: "ready", journal };
};

export const showActivityError = (state: ShowActivityFailure) => ({
	title: "Unable to load activity",
	detail:
		state.status === "transport-error"
			? "Your recorded activity could not be loaded. Check your connection and try again."
			: "This activity came back in a form that could not be displayed. Try again later.",
});

const reviewLabel = (event: ShowActivityEvent) =>
	event.rating === null ? "Wrote a review" : `Rated ${decimalLabel(event.rating)}/100`;

const progressLabel = (event: EpisodeActivityEvent) =>
	event.progressPercent === null
		? `Made progress in ${event.episode.name}`
		: `Reached ${decimalLabel(event.progressPercent)}% in ${event.episode.name}`;

const parentEventLabel = (event: ParentActivityEvent) =>
	Match.value(event.eventSchemaSlug).pipe(
		Match.when("review", () => reviewLabel(event)),
		Match.when("backlog", () => "Added to backlog"),
		Match.when("dropped", () => "Stopped watching"),
		Match.when("complete", () => "Completed the show"),
		Match.when("on_hold", () => "Put this show on hold"),
		Match.exhaustive,
	);

const episodeEventLabel = (event: EpisodeActivityEvent) =>
	Match.value(event.eventSchemaSlug).pipe(
		Match.when("review", () => reviewLabel(event)),
		Match.when("progress", () => progressLabel(event)),
		Match.when("complete", () => `Watched ${event.episode.name}`),
		Match.exhaustive,
	);

const collectionEventLabel = (event: CollectionActivityEvent) =>
	Match.value(event.eventSchemaSlug).pipe(
		Match.when("add-entity-to-collection", () => `Added to ${event.collection.name}`),
		Match.when("remove-entity-from-collection", () => `Removed from ${event.collection.name}`),
		Match.exhaustive,
	);

export const showActivityLabel = (event: ShowActivityEvent) =>
	Match.value(event).pipe(
		Match.when({ kind: "parent" }, parentEventLabel),
		Match.when({ kind: "episode" }, episodeEventLabel),
		Match.when({ kind: "collection" }, collectionEventLabel),
		Match.exhaustive,
	);

const episodeContextLabel = (event: EpisodeActivityEvent) =>
	event.eventSchemaSlug === "review"
		? `${showEpisodeOriginLabel(event.episode)} • ${event.episode.name}`
		: showEpisodeOriginLabel(event.episode);

const recordedTimeLabel = (minutes: number) => {
	const total = Math.max(Math.round(minutes), 0);
	const rest = total % 60;
	const hours = Math.floor(total / 60);
	if (hours === 0) {
		return `${rest}m recorded time`;
	}
	return rest === 0 ? `${hours}h recorded time` : `${hours}h ${rest}m recorded time`;
};

export const showActivityMetaLabel = (event: ShowActivityEvent) => {
	const consumedOn = optionalText(event.consumedOn);
	return [
		event.kind === "episode" ? episodeContextLabel(event) : undefined,
		consumedOn === undefined ? undefined : `Watched on ${consumedOn}`,
		event.timeSpent === null ? undefined : recordedTimeLabel(event.timeSpent),
	]
		.filter((part) => part !== undefined)
		.join(" • ");
};

export const showActivityReviewText = (event: ShowActivityEvent) =>
	event.eventSchemaSlug === "review" ? optionalText(event.text) : undefined;

export const showActivityToneClass = (event: ShowActivityEvent) =>
	Match.value(event.eventSchemaSlug).pipe(
		Match.when("review", () => "bg-gold"),
		Match.when("progress", () => "bg-accent"),
		Match.when("complete", () => "bg-success"),
		Match.when("add-entity-to-collection", () => "bg-info"),
		Match.when("remove-entity-from-collection", () => "bg-danger"),
		Match.orElse(() => "bg-border-strong"),
	);

export const showActivityEpisodeAsset = (episode: ShowActivityEpisode) =>
	preferredMediaImageAsset(episode.images, "still");

export const showActivityManagedAssets = (journal: ShowActivityJournal) =>
	collectManagedAssetLocators(
		journal.cycles
			.flatMap((cycle) => cycle.days.flatMap((day) => day.entries))
			.flatMap((event) =>
				event.kind === "episode" ? [showActivityEpisodeAsset(event.episode)] : [],
			),
	);
