import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { foldChangeImages, type FoldEventChange } from "@ryot-app/plugin-backend-sdk/folds";

import { consumptionEventSlugs } from "../../shared/consumption-projection";
import { isPositional } from "../../shared/media-schema-slugs";
import { consumptionContributions } from "./consumption";
import {
	compareHistory,
	deriveHistory,
	type FoldEvent,
	latestPosition,
	type MediaFoldValue,
	sortedOccurrences,
} from "./history";

/** The subject history reads an incremental run may make; each returns only the subject's own events. */
export type MediaHistoryReads<E, R> = {
	readonly inventory: Effect.Effect<ReadonlyArray<string>, E, R>;
	readonly history: Effect.Effect<ReadonlyArray<FoldEvent>, E, R>;
	/**
	 * Whether an episodic subject has a required episode other than `excluded` that its current cycle
	 * has not completed, with every change already written.
	 */
	readonly uncovered: (input: {
		readonly excluded: ReadonlyArray<string>;
	}) => Effect.Effect<boolean, E, R>;
	/** An entity's unsourced completions that occurred at or before `until`. */
	readonly completions: (input: {
		readonly until: string;
		readonly entityId: string;
	}) => Effect.Effect<ReadonlyArray<FoldEvent>, E, R>;
	/** An entity's consumption events that occurred at or after `from`, or all of them. */
	readonly entity: (input: {
		readonly entityId: string;
		readonly from: null | string;
	}) => Effect.Effect<ReadonlyArray<FoldEvent>, E, R>;
	/** An entity's consumption events in the listed source runs. */
	readonly runs: (input: {
		readonly entityId: string;
		readonly runs: ReadonlyArray<string>;
	}) => Effect.Effect<ReadonlyArray<FoldEvent>, E, R>;
	/** At most `limit` consumption events other than `excluded` that occurred at or after `from`. */
	readonly since: (input: {
		readonly from: string;
		readonly limit: number;
		readonly excluded: ReadonlyArray<string>;
	}) => Effect.Effect<ReadonlyArray<FoldEvent>, E, R>;
};

type HistorySubject = {
	readonly id: string;
	readonly terminal: boolean;
	readonly episodic: boolean;
};

const sinceLimit = 20;

const iso = (value: string) => new Date(Date.parse(value)).toISOString();

/** History compares instants; reads and change images spell them differently. */
export const normalizedEvent = (event: FoldEvent): FoldEvent => ({
	...event,
	occurredAt: iso(event.occurredAt),
	orderCreatedAt: iso(event.orderCreatedAt),
});

const isConsumption = (event: FoldEvent) =>
	consumptionEventSlugs.some((slug) => slug === event.eventSchemaSlug);

const sourceRunOf = (event: FoldEvent) => {
	const run = event.properties["sourceRun"];
	return typeof run === "string" ? run : null;
};

const isUnsourced = (event: FoldEvent) =>
	sourceRunOf(event) === null && event.eventSchemaSlug !== "item-complete";

const isExplicitCompletion = (event: FoldEvent) =>
	event.eventSchemaSlug === "complete" && typeof event.properties["completionKey"] !== "string";

const earliest = (events: ReadonlyArray<FoldEvent>) =>
	events.reduce<undefined | FoldEvent>(
		(first, event) => (first === undefined || compareHistory(event, first) < 0 ? event : first),
		undefined,
	);

/**
 * Folds a subject's whole history, or with `changes` only the runs they touch:
 *
 * - Each touched entity replays from the completion before its earliest change to the present, plus
 *   touched source runs in full. A changed explicit completion of a positional title decides whether
 *   every earlier progress completes, so that replay starts at the previous explicit completion.
 * - An episodic subject's coverage spans every episode, so it replays in full unless `keepsCoverage`
 *   shows the change cannot alter its coverage completions.
 */
export const foldMediaHistory = Effect.fn("foldMediaHistory")(function* <E, R>(input: {
	readonly subject: HistorySubject;
	readonly previous: MediaFoldValue;
	readonly reads: MediaHistoryReads<E, R>;
	readonly renamedKeys?: ReadonlyMap<string, string>;
	readonly changes: null | ReadonlyArray<FoldEventChange>;
}) {
	const replay = Effect.gen(function* () {
		const derived = yield* deriveHistory({
			subject: input.subject,
			previous: input.previous,
			inventory: input.reads.inventory,
			events: (yield* input.reads.history).map(normalizedEvent),
			...(input.renamedKeys === undefined ? {} : { renamedKeys: input.renamedKeys }),
		});
		return {
			value: derived.value,
			changes: derived.changes,
			contributions: yield* consumptionContributions(derived),
		};
	});
	if (input.changes === null) {
		return yield* replay;
	}
	const images = foldChangeImages(input.changes);
	const added = images.added.map(normalizedEvent).filter(isConsumption);
	const retracted = images.retracted.map(normalizedEvent).filter(isConsumption);
	if (added.length === 0 && retracted.length === 0) {
		return { changes: [], contributions: [], value: input.previous };
	}
	const changedIds = new Set([...added, ...retracted].map(({ id }) => id));
	if (input.subject.episodic && !(yield* keepsCoverage(input, added, retracted, changedIds))) {
		return yield* replay;
	}
	const entities = [...new Set([...added, ...retracted].map(({ entityId }) => entityId))].sort();
	const window = new Map<string, FoldEvent>();
	const context = new Set<string>();
	for (const entityId of entities) {
		const touched = [...added, ...retracted].filter((event) => event.entityId === entityId);
		const runs = [
			...new Set(
				touched.flatMap((event) => (sourceRunOf(event) === null ? [] : [sourceRunOf(event) ?? ""])),
			),
		];
		const sourced = runs.length === 0 ? [] : yield* input.reads.runs({ runs, entityId });
		const items = added.filter(
			(event) => event.entityId === entityId && event.eventSchemaSlug === "item-complete",
		);
		const oldest = earliest(touched);
		const positional =
			touched.some((event) => isPositional(event.entitySchemaSlug)) &&
			touched.some((event) => event.eventSchemaSlug === "complete" && isUnsourced(event));
		const start =
			oldest === undefined
				? undefined
				: (yield* input.reads.completions({ entityId, until: oldest.occurredAt }))
						.map(normalizedEvent)
						.filter(
							(event) =>
								!changedIds.has(event.id) &&
								isUnsourced(event) &&
								compareHistory(event, oldest) < 0 &&
								(!positional || isExplicitCompletion(event)),
						)
						.reduce<undefined | FoldEvent>(
							(last, event) =>
								last === undefined || compareHistory(event, last) > 0 ? event : last,
							undefined,
						);
		const touchedRuns = new Set(runs);
		for (const event of (yield* input.reads.entity({
			entityId,
			from: start?.occurredAt ?? null,
		})).map(normalizedEvent)) {
			window.set(event.id, event);
			const run = sourceRunOf(event);
			if (
				(run === null &&
					isUnsourced(event) &&
					start !== undefined &&
					compareHistory(event, start) <= 0) ||
				(run !== null && !touchedRuns.has(run))
			) {
				context.add(event.id);
			}
		}
		for (const event of [...sourced.map(normalizedEvent), ...items]) {
			window.set(event.id, event);
			context.delete(event.id);
		}
	}
	for (const event of retracted) {
		window.delete(event.id);
	}
	for (const event of added) {
		window.set(event.id, event);
	}
	const scope = new Set([...window.keys(), ...retracted.map(({ id }) => id)]);
	const derived = yield* deriveHistory({
		scope,
		subject: input.subject,
		previous: input.previous,
		events: [...window.values()],
		inventory: input.reads.inventory,
		...(input.subject.episodic ? { fresh: new Set(added.map(({ id }) => id)) } : {}),
	});
	const occurrences = sortedOccurrences([
		...input.previous.occurrences.filter(
			(value) => !(value.rule === "progress" && scope.has(value.sourceEventId)),
		),
		...derived.value.occurrences,
	]);
	const counted = latestPosition(input.previous.counted, derived.counted);
	const waiting = input.previous.waiting === true && !added.some(isExplicitCompletion);
	const value: MediaFoldValue = {
		occurrences,
		...(input.subject.episodic
			? {
					terminal: input.subject.terminal,
					...(waiting ? { waiting } : {}),
					...(counted ? { counted } : {}),
				}
			: {}),
	};
	return {
		value,
		changes: derived.changes,
		contributions: yield* consumptionContributions({ ...derived, context }),
	};
});

/**
 * Whether an episodic subject's change leaves its coverage completions as they are, so only the
 * entities it touches replay. It must be an append, every changed event created after every existing
 * consumption event, so coverage is judged as before up to the appended events. There it can still
 * change: by restoring a lapsed coverage occurrence whose closing source is in the open cycle, by the
 * subject newly becoming terminal, or on a terminal subject once every required episode is covered.
 * An episode the append progresses may complete, so it does not count as uncovered.
 */
const keepsCoverage = Effect.fnUntraced(function* <E, R>(
	input: {
		readonly subject: HistorySubject;
		readonly previous: MediaFoldValue;
		readonly reads: MediaHistoryReads<E, R>;
	},
	added: ReadonlyArray<FoldEvent>,
	retracted: ReadonlyArray<FoldEvent>,
	changedIds: ReadonlySet<string>,
) {
	const first = earliest(added);
	const later =
		retracted.length > 0 || first === undefined
			? []
			: (yield* input.reads.since({
					limit: sinceLimit,
					from: first.occurredAt,
					excluded: [...changedIds],
				})).map(normalizedEvent);
	const simultaneous = later.some((event) =>
		added.some(({ occurredAt }) => occurredAt === event.occurredAt),
	);
	const append =
		retracted.length === 0 &&
		later.length < sinceLimit &&
		added.every((event) => later.every((existing) => compareHistory(event, existing) > 0)) &&
		!(simultaneous && added.some(isExplicitCompletion));
	if (!append) {
		return false;
	}
	const episodes = added.filter(
		(event) =>
			event.entityId !== input.subject.id &&
			(event.eventSchemaSlug === "complete" || event.eventSchemaSlug === "progress"),
	);
	if (episodes.length === 0) {
		return true;
	}
	if (
		input.previous.waiting === true ||
		(input.subject.terminal && input.previous.terminal !== true)
	) {
		return false;
	}
	return (
		!input.subject.terminal ||
		(yield* input.reads.uncovered({
			excluded: episodes
				.filter(({ eventSchemaSlug }) => eventSchemaSlug === "progress")
				.map(({ entityId }) => entityId),
		}))
	);
});
