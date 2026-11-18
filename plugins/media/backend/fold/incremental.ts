import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { type FoldEventChange, foldChangeImages } from "@ryot-app/plugin-backend-sdk/folds";

import { consumptionEventSlugs } from "../../shared/consumption-projection";
import { isPositional } from "../../shared/media-schema-slugs";
import { consumptionContributions, type FoldTail } from "./consumption";
import {
	compareHistory,
	deriveHistory,
	type FoldEvent,
	type MediaFoldValue,
	sortedOccurrences,
} from "./history";

type HistorySubject = {
	readonly id: string;
	readonly terminal: boolean;
	readonly episodic: boolean;
};

/** The subject history reads an incremental run may make; each returns only the subject's own events. */
export type MediaHistoryReads<E, R> = {
	readonly history: Effect.Effect<ReadonlyArray<FoldEvent>, E, R>;
	readonly inventory: Effect.Effect<ReadonlyArray<string>, E, R>;
	/** At most `limit` consumption events other than `excluded` that occurred at or after `from`. */
	readonly since: (input: {
		readonly from: string;
		readonly limit: number;
		readonly excluded: ReadonlyArray<string>;
	}) => Effect.Effect<ReadonlyArray<FoldEvent>, E, R>;
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
 * - An append continues each touched entity from its stored unfinished run. It reads only events at
 *   the instants it lands on, none when it is newest; an append to a source run reads that run.
 * - Otherwise each touched entity replays from the completion before its earliest change to the
 *   present. A changed explicit completion of a positional title decides whether every earlier
 *   progress completes, so that replay starts at the previous explicit completion.
 * - Coverage of an episodic subject resumes from its carry on an append and replays in full otherwise.
 */
export const foldMediaHistory = Effect.fn("foldMediaHistory")(function* <E, R>(input: {
	readonly subject: HistorySubject;
	readonly previous: MediaFoldValue;
	readonly renamedKeys?: ReadonlyMap<string, string>;
	readonly changes: null | ReadonlyArray<FoldEventChange>;
	readonly reads: MediaHistoryReads<E, R>;
}) {
	const replay = Effect.gen(function* () {
		const derived = yield* deriveHistory({
			subject: input.subject,
			previous: input.previous,
			inventory: input.reads.inventory,
			events: (yield* input.reads.history).map(normalizedEvent),
			...(input.renamedKeys === undefined ? {} : { renamedKeys: input.renamedKeys }),
		});
		const { contributions, tails } = yield* consumptionContributions(derived);
		return {
			changes: derived.changes,
			contributions,
			value: withTails(derived.value, tails),
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
	const first = earliest(added);
	const later =
		retracted.length > 0 || first === undefined
			? []
			: (yield* input.reads.since({
					limit: sinceLimit,
					from: first.occurredAt,
					excluded: [...changedIds],
				})).map(normalizedEvent);
	const simultaneous = later.filter((event) =>
		added.some(({ occurredAt }) => occurredAt === event.occurredAt),
	);
	const append =
		retracted.length === 0 &&
		later.length < sinceLimit &&
		added.every((event) => later.every((existing) => compareHistory(event, existing) > 0)) &&
		!added.some(
			(event) =>
				isExplicitCompletion(event) &&
				(simultaneous.length > 0 || (isUnsourced(event) && isPositional(event.entitySchemaSlug))),
		);
	if (input.subject.episodic && !append) {
		return yield* replay;
	}
	const entities = [...new Set([...added, ...retracted].map(({ entityId }) => entityId))].sort();
	const window = new Map<string, FoldEvent>();
	const context = new Set<string>();
	for (const entityId of entities) {
		const touched = [...added, ...retracted].filter((event) => event.entityId === entityId);
		const runs = [
			...new Set(touched.flatMap((event) => (sourceRunOf(event) === null ? [] : [sourceRunOf(event) ?? ""]))),
		];
		const sourced = runs.length === 0 ? [] : yield* input.reads.runs({ entityId, runs });
		const items = added.filter(
			(event) => event.entityId === entityId && event.eventSchemaSlug === "item-complete",
		);
		if (append) {
			const tail = input.previous.tails?.[entityId] ?? { lead: [], run: [] };
			for (const event of [...simultaneous, ...tail.lead]) {
				if (event.entityId === entityId && !tail.run.some(({ id }) => id === event.id)) {
					window.set(event.id, event);
					context.add(event.id);
				}
			}
			for (const event of [...tail.run, ...sourced.map(normalizedEvent), ...touched]) {
				window.set(event.id, event);
				context.delete(event.id);
			}
			continue;
		}
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
							(last, event) => (last === undefined || compareHistory(event, last) > 0 ? event : last),
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
				(run === null && isUnsourced(event) && start !== undefined && compareHistory(event, start) <= 0) ||
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
		...(input.subject.episodic
			? {
					coverage: {
						fresh: new Set(added.map(({ id }) => id)),
						carry: input.previous.coverage ?? { basis: null, used: [], covered: [] },
					},
				}
			: {}),
	});
	if (derived.coverageOccurrences.length > 0) {
		return yield* replay;
	}
	const { contributions, tails } = yield* consumptionContributions({ ...derived, context });
	const occurrences = sortedOccurrences([
		...input.previous.occurrences.filter(
			(value) => !(value.rule === "progress" && scope.has(value.sourceEventId)),
		),
		...derived.value.occurrences,
	]);
	const kept = Object.entries(input.previous.tails ?? {}).filter(
		([entityId]) => !entities.includes(entityId),
	);
	const value: MediaFoldValue = {
		occurrences,
		...(input.subject.episodic
			? {
					terminal: input.subject.terminal,
					coverage: derived.value.coverage ?? { basis: null, used: [], covered: [] },
					coverageSources: [
						...new Set([...(input.previous.coverageSources ?? []), ...derived.coverageSources]),
					].sort(),
				}
			: {}),
	};
	return {
		contributions,
		changes: derived.changes,
		value: withTails(value, new Map([...kept, ...tails])),
	};
});

const withTails = (value: MediaFoldValue, tails: ReadonlyMap<string, FoldTail>): MediaFoldValue => {
	const { tails: _previous, ...rest } = value;
	const entries = [...tails].sort(([left], [right]) => (left < right ? -1 : 1));
	const stored = (events: ReadonlyArray<FoldEvent>) =>
		events.map((event) => ({
							id: event.id,
							revision: event.revision,
							entityId: event.entityId,
							orderKey: event.orderKey,
							properties: event.properties,
							eventSchemaSlug: event.eventSchemaSlug,
							entitySchemaSlug: event.entitySchemaSlug,
							sessionEntityId: event.sessionEntityId,
			occurredAt: iso(event.occurredAt),
			orderCreatedAt: iso(event.orderCreatedAt),
		}));
	return entries.length === 0
		? rest
		: {
				...rest,
				tails: Object.fromEntries(
					entries.map(([entityId, { lead, run }]) => [
						entityId,
						{ lead: stored(lead), run: stored(run) },
					]),
				),
			};
};
