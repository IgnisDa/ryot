import {
	createEventChange,
	deleteEventChange,
	type EventChange,
	existingEntity,
	updateEventChange,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { FoldEventImage } from "@ryot-app/plugin-backend-sdk/folds";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import { EntityId, EventId, jsonValueEquals } from "@ryot-app/plugin-kit/schema";

import { mergeConsumedOn } from "../../shared/consumed-on";
import { ConsumptionBasis, progressReachesTotal } from "../../shared/consumption";
import { isPositional } from "../../shared/media-schema-slugs";

/** A fold event as history reads and change images both supply it, without ID brands. */
export type FoldEvent = typeof FoldEventImage.Encoded;

const WrittenOutput = Schema.Struct({
	entityId: Schema.String,
	orderKey: Schema.String,
	occurredAt: Schema.String,
	orderCreatedAt: Schema.String,
	sessionEntityId: Schema.NullOr(Schema.String),
	properties: Schema.Record(Schema.String, Schema.Json),
});
type WrittenOutput = typeof WrittenOutput.Type;

export const Occurrence = Schema.Struct({
	key: Schema.String,
	silent: Schema.Boolean,
	sourceEventId: Schema.String,
	written: Schema.NullOr(WrittenOutput),
	covered: Schema.optionalKey(Schema.Int),
	total: Schema.optionalKey(Schema.Finite),
	rule: Schema.Literals(["progress", "coverage"]),
	status: Schema.Literals(["active", "inactive", "suppressed", "overridden"]),
});
export type Occurrence = typeof Occurrence.Type;

const HistoryPosition = Schema.Struct({
	id: Schema.String,
	orderKey: Schema.String,
	occurredAt: Schema.String,
	orderCreatedAt: Schema.String,
});
type HistoryPosition = typeof HistoryPosition.Type;

/**
 * An episodic subject also keeps whether it was terminal, `counted`, the latest episode completion
 * source its coverage has counted, and `waiting` while a coverage occurrence that did not restore
 * still has its closing source in the open cycle.
 */
export const MediaFoldValue = Schema.Struct({
	occurrences: Schema.Array(Occurrence),
	terminal: Schema.optionalKey(Schema.Boolean),
	counted: Schema.optionalKey(HistoryPosition),
	waiting: Schema.optionalKey(Schema.Literal(true)),
});
export type MediaFoldValue = typeof MediaFoldValue.Type;

/**
 * Takes on the occurrences of subjects merged or restored into this one, so what a user suppressed and the
 * completions covered there carry over. Their outputs are compared afresh, because their IDs changed.
 */
export const absorbFoldValues = (
	previous: MediaFoldValue,
	absorbed: ReadonlyArray<{
		readonly value: MediaFoldValue;
		readonly ids: Readonly<Record<string, string>>;
	}>,
) => {
	const occurrences = new Map(previous.occurrences.map((value) => [value.key, value]));
	let counted = previous.counted;
	const renamedKeys = new Map<string, string>();
	for (const { ids, value } of absorbed) {
		const id = (token: string) => ids[token] ?? token;
		for (const occurrence of value.occurrences) {
			const key = occurrence.key.split(":").map(id).join(":");
			renamedKeys.set(occurrence.key, key);
			if (!occurrences.has(key)) {
				occurrences.set(key, {
					...occurrence,
					key,
					written: null,
					sourceEventId: id(occurrence.sourceEventId),
				});
			}
		}
		if (value.counted) {
			counted = latestPosition(counted, {
				...value.counted,
				id: id(value.counted.id),
				orderKey: id(value.counted.orderKey),
			});
		}
	}
	return {
		renamedKeys,
		value: {
			...previous,
			occurrences: [...occurrences.values()],
			...(counted ? { counted } : {}),
		} satisfies MediaFoldValue,
	};
};

type HistorySubject = {
	readonly id: string;
	readonly terminal: boolean;
	readonly episodic: boolean;
};

type Desired = {
	readonly anchor: FoldEvent;
	readonly output: WrittenOutput;
	readonly occurrence: Occurrence;
	readonly suffix: "parent" | "complete";
};

const time = (value: string) => Date.parse(value);

export const compareText = (left: string, right: string) => {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
};

export const sortedOccurrences = (values: ReadonlyArray<Occurrence>) =>
	[...values].sort((left, right) => compareText(left.key, right.key));

const statusOf = (prior: undefined | Occurrence): Occurrence["status"] =>
	prior === undefined || prior.status === "inactive" ? "active" : prior.status;

/** History order: occurrence time, source creation time, then source order key and ID. */
export const compareHistory = (left: HistoryPosition, right: HistoryPosition) =>
	time(left.occurredAt) - time(right.occurredAt) ||
	time(left.orderCreatedAt) - time(right.orderCreatedAt) ||
	compareText(left.orderKey, right.orderKey) ||
	compareText(left.id, right.id);

const positionOf = ({ id, orderKey, occurredAt, orderCreatedAt }: HistoryPosition) => ({
	id,
	orderKey,
	occurredAt,
	orderCreatedAt,
});

export const latestPosition = (
	left: undefined | HistoryPosition,
	right: undefined | HistoryPosition,
): undefined | HistoryPosition => {
	if (left === undefined || right === undefined) {
		return left ?? right;
	}
	return compareHistory(right, left) > 0 ? right : left;
};

const completionKeyOf = (event: FoldEvent) => {
	const key = event.properties["completionKey"];
	return event.eventSchemaSlug === "complete" && typeof key === "string" ? key : undefined;
};

const written = (event: FoldEvent): WrittenOutput => ({
	entityId: event.entityId,
	orderKey: event.orderKey,
	properties: event.properties,
	occurredAt: event.occurredAt,
	orderCreatedAt: event.orderCreatedAt,
	sessionEntityId: event.sessionEntityId,
});

const optional = (key: string, value: JsonValue | undefined, keep: boolean) =>
	keep && value !== undefined ? { [key]: value } : {};

const consumedOnOf = (event: FoldEvent) => {
	const value = event.properties["consumedOn"];
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
};

const sourceRunOf = (event: FoldEvent) => {
	const run = event.properties["sourceRun"];
	return typeof run === "string" ? run : null;
};

/**
 * Derives a subject's automatic completions from its history and its previous fold value. Progress
 * that reaches its total completes its item; complete coverage of an episodic subject's required
 * episodes completes the subject. A deleted automatic completion stays suppressed and an edited one
 * becomes explicit, keeping its order. A stored coverage completion is restored at the first episode
 * completion of a cycle that holds its closing source and has completed as many episodes as it
 * required, so a replay of the fold's own output changes nothing. A new one needs a closing completion
 * later than every one the previous fold counted, or a subject that just became terminal: an inventory
 * change alone completes nothing.
 */
export const deriveHistory = Effect.fn("deriveHistory")(function* <E, R>(input: {
	readonly subject: HistorySubject;
	readonly previous: MediaFoldValue;
	/** Limits progress occurrences to those sourced by these events; the value then holds only them. */
	readonly scope?: ReadonlySet<string>;
	/**
	 * Judges no coverage, only recording the episode completions `fresh` events source, for a caller
	 * that has ruled out a coverage completion.
	 */
	readonly fresh?: ReadonlySet<string>;
	readonly events: ReadonlyArray<FoldEvent>;
	/** Completions restored under a key whose source has since changed ID still answer to that occurrence. */
	readonly renamedKeys?: ReadonlyMap<string, string>;
	readonly inventory: Effect.Effect<ReadonlyArray<string>, E, R>;
}) {
	const inScope = (value: undefined | Occurrence) =>
		value !== undefined &&
		(input.scope === undefined ||
			(value.rule === "progress" && input.scope.has(value.sourceEventId)));
	const changes: Array<EventChange> = [];
	const sorted = [...input.events].sort(compareHistory);
	const previous = new Map(input.previous.occurrences.map((value) => [value.key, value]));
	const outputs = new Map<string, FoldEvent>();
	for (const event of sorted) {
		const key = completionKeyOf(event);
		if (key !== undefined) {
			outputs.set(input.renamedKeys?.get(key) ?? key, event);
		}
	}
	const overridden = new Set<string>();
	for (const value of input.previous.occurrences) {
		if (!inScope(value) || value.status !== "active" || value.written === null) {
			continue;
		}
		const actual = outputs.get(value.key);
		if (actual === undefined) {
			previous.set(value.key, { ...value, written: null, status: "suppressed" });
		} else if (!jsonValueEquals(written(actual), value.written)) {
			overridden.add(actual.id);
			outputs.delete(value.key);
			previous.set(value.key, { ...value, written: null, status: "overridden" });
			changes.push(
				updateEventChange(EventId.make(actual.id), {
					properties: { set: {}, remove: ["completionKey", "completionSilent"] },
				}),
			);
		}
	}
	const history = sorted.map((event) => {
		if (!overridden.has(event.id)) {
			return event;
		}
		const { completionKey: _key, completionSilent: _silent, ...properties } = event.properties;
		return Object.assign({}, event, { properties });
	});
	const explicitCompletions = history.filter(
		(event) => event.eventSchemaSlug === "complete" && completionKeyOf(event) === undefined,
	);

	const desired: Array<Desired> = [];
	const output = (
		occurrence: Occurrence,
		anchor: FoldEvent,
		closing: FoldEvent,
		suffix: Desired["suffix"],
		target: { readonly entityId: string; readonly sessionEntityId: null | string },
		properties: Readonly<Record<string, JsonValue>>,
	) => {
		const value: WrittenOutput = {
			...target,
			orderKey: `${anchor.orderKey}~${suffix}`,
			occurredAt: new Date(time(closing.occurredAt)).toISOString(),
			orderCreatedAt: new Date(time(anchor.orderCreatedAt)).toISOString(),
			properties: {
				completionKey: occurrence.key,
				completionSilent: occurrence.silent,
				...properties,
			},
		};
		const settled = { ...occurrence, written: occurrence.status === "active" ? value : null };
		if (occurrence.status === "active") {
			desired.push({ anchor, suffix, output: value, occurrence: settled });
		}
		return settled;
	};

	const occurrences: Array<Occurrence> = [];
	const progressFull: Array<FoldEvent> = [];
	const progressSources = new Map<string, FoldEvent>();
	for (const source of history) {
		if (source.eventSchemaSlug !== "progress") {
			continue;
		}
		const key = `progress:${source.id}`;
		const prior = previous.get(key);
		const positional = isPositional(source.entitySchemaSlug);
		const basis = Schema.decodeUnknownOption(ConsumptionBasis)(
			source.properties["consumptionBasis"],
		);
		const total = prior?.total ?? (basis._tag === "Some" ? (basis.value.total ?? 0) : 0);
		const sourceRun = sourceRunOf(source);
		const blocked = explicitCompletions.some(
			(explicit) =>
				explicit.entityId === source.entityId &&
				sourceRunOf(explicit) === sourceRun &&
				(time(explicit.occurredAt) === time(source.occurredAt) ||
					((positional || sourceRun !== null) && compareHistory(explicit, source) > 0)),
		);
		const sameTime =
			positional &&
			prior === undefined &&
			progressFull.some(
				(other) =>
					other.entityId === source.entityId &&
					sourceRunOf(other) === sourceRun &&
					time(other.occurredAt) === time(source.occurredAt),
			);
		const full =
			progressReachesTotal(
				source.properties,
				basis._tag === "Some" ? basis.value : undefined,
				total,
			) &&
			!blocked &&
			!sameTime;
		if (!full) {
			continue;
		}
		progressFull.push(source);
		progressSources.set(key, source);
		occurrences.push(
			output(
				{
					key,
					total,
					written: null,
					rule: "progress",
					status: statusOf(prior),
					sourceEventId: source.id,
					silent: prior?.silent ?? source.revision !== 0,
				},
				source,
				source,
				"complete",
				{ entityId: source.entityId, sessionEntityId: source.sessionEntityId },
				{
					...optional("sourceRun", source.properties["sourceRun"], sourceRun !== null),
					...optional(
						"consumptionBasis",
						source.properties["consumptionBasis"],
						basis._tag === "Some",
					),
					...optional(
						"calendarDate",
						source.properties["calendarDate"],
						typeof source.properties["calendarDate"] === "string",
					),
					...optional(
						"timeSpent",
						source.properties["timeSpent"],
						typeof source.properties["timeSpent"] === "number",
					),
					...optional("consumedOn", consumedOnOf(source), consumedOnOf(source).length > 0),
					...optional("dateUnknown", true, source.properties["dateUnknown"] === true),
				},
			),
		);
	}

	const progressOutputs = new Map(
		desired
			.filter(({ suffix }) => suffix === "complete")
			.map((value) => [value.occurrence.key, value]),
	);
	const effective = [
		...history.filter((event) => completionKeyOf(event) === undefined),
		...[...progressOutputs.values()].map((value): FoldEvent =>
			Object.assign({}, value.output, {
				revision: 0,
				eventSchemaSlug: "complete",
				entitySchemaSlug: value.anchor.entitySchemaSlug,
				id: outputs.get(value.occurrence.key)?.id ?? `virtual:${value.occurrence.key}`,
			}),
		),
	].sort(compareHistory);

	const sourceOf = (event: FoldEvent) => {
		const key = completionKeyOf(event);
		return key === undefined ? event : progressSources.get(key);
	};
	const isEpisodeCompletion = (event: FoldEvent) =>
		event.eventSchemaSlug === "complete" && event.entityId !== input.subject.id;
	let counted: undefined | HistoryPosition;
	let waiting = false;
	if (input.subject.episodic && input.fresh !== undefined) {
		for (const event of effective) {
			const source = sourceOf(event);
			if (isEpisodeCompletion(event) && source !== undefined && input.fresh.has(source.id)) {
				counted = latestPosition(counted, positionOf(source));
			}
		}
	} else if (input.subject.episodic) {
		let live: undefined | ReadonlyArray<string>;
		const used = new Set<string>();
		const frozen = input.previous.occurrences.filter(
			(value) => value.rule === "coverage" && value.covered !== undefined,
		);
		let coverage = new Map<
			string,
			{ readonly source: string; readonly dateUnknown: boolean; readonly consumedOn: string[] }
		>();
		const inCycle = (source: string) =>
			[...coverage.values()].some((value) => value.source === source);
		const becameTerminal = input.subject.terminal && input.previous.terminal !== true;
		for (const event of effective) {
			if (event.eventSchemaSlug !== "progress" && event.eventSchemaSlug !== "complete") {
				continue;
			}
			if (event.entityId === input.subject.id) {
				if (event.eventSchemaSlug === "complete" && completionKeyOf(event) === undefined) {
					coverage = new Map();
				}
				continue;
			}
			if (event.eventSchemaSlug === "progress") {
				coverage.delete(event.entityId);
				continue;
			}
			const progressKey = completionKeyOf(event);
			const progressSource =
				progressKey === undefined ? undefined : progressSources.get(progressKey);
			const anchor = progressSource ?? event;
			const unseen =
				input.previous.counted === undefined || compareHistory(anchor, input.previous.counted) > 0;
			counted = latestPosition(counted, positionOf(anchor));
			coverage.set(event.entityId, {
				source: anchor.id,
				consumedOn: consumedOnOf(event),
				dateUnknown: event.properties["dateUnknown"] === true,
			});
			const restored = frozen.find(
				({ key, covered = 0, sourceEventId }) =>
					!used.has(key) && coverage.size >= covered && inCycle(sourceEventId),
			);
			const key = restored?.key ?? `coverage:${anchor.id}`;
			if (restored === undefined) {
				const required = (live ??= yield* input.inventory);
				if (
					required.length === 0 ||
					!required.every((episodeId) => coverage.has(episodeId)) ||
					!input.subject.terminal ||
					used.has(key) ||
					(!unseen && !becameTerminal)
				) {
					continue;
				}
			}
			const prior = previous.get(key);
			used.add(key);
			const entries = [...coverage].sort(([left], [right]) => compareText(left, right));
			const consumedOn = mergeConsumedOn(...entries.map(([, item]) => item.consumedOn));
			const dateUnknown = entries.every(([, item]) => item.dateUnknown);
			occurrences.push(
				output(
					{
						key,
						written: null,
						rule: "coverage",
						status: statusOf(prior),
						sourceEventId: anchor.id,
						silent: prior?.silent ?? anchor.revision !== 0,
						covered: restored?.covered ?? live?.length ?? 0,
					},
					anchor,
					event,
					"parent",
					{ entityId: input.subject.id, sessionEntityId: input.subject.id },
					{
						consumptionBasis: { unit: "episodes" },
						...optional("consumedOn", consumedOn, consumedOn.length > 0),
						...optional("dateUnknown", true, dateUnknown),
						...optional(
							"calendarDate",
							event.properties["calendarDate"],
							!dateUnknown && typeof event.properties["calendarDate"] === "string",
						),
					},
				),
			);
			coverage = new Map();
		}
		waiting = frozen.some(({ key, sourceEventId }) => !used.has(key) && inCycle(sourceEventId));
	}

	const wanted = new Map(desired.map((value) => [value.occurrence.key, value]));
	for (const [key, actual] of outputs) {
		// A completion merged in from another title was never this fold's to remove.
		if (!wanted.has(key) && inScope(previous.get(key))) {
			changes.push(deleteEventChange(EventId.make(actual.id)));
		}
	}
	for (const value of desired) {
		const actual = outputs.get(value.occurrence.key);
		const orderAfter = { suffix: value.suffix, eventId: EventId.make(value.anchor.id) };
		const { sessionEntityId } = value.output;
		const session = sessionEntityId === null ? null : EntityId.make(sessionEntityId);
		if (actual === undefined) {
			changes.push(
				createEventChange(`complete:${value.occurrence.key}`, {
					orderAfter,
					eventSchemaSlug: "complete",
					occurredAt: value.output.occurredAt,
					properties: value.output.properties,
					entity: existingEntity(EntityId.make(value.output.entityId)),
					...(session === null ? {} : { session: existingEntity(session) }),
				}),
			);
		} else if (!jsonValueEquals(written(actual), value.output)) {
			changes.push(
				updateEventChange(EventId.make(actual.id), {
					orderAfter,
					occurredAt: value.output.occurredAt,
					...(actual.entityId === value.output.entityId
						? {}
						: { entityId: EntityId.make(value.output.entityId) }),
					...(actual.sessionEntityId === sessionEntityId ? {} : { sessionEntityId: session }),
					properties: {
						set: value.output.properties,
						remove: Object.keys(actual.properties).filter(
							(key) => !Object.hasOwn(value.output.properties, key),
						),
					},
				}),
			);
		}
	}
	const present = new Set(history.map(({ id }) => id));
	const kept = [...previous.values()].flatMap((value): ReadonlyArray<Occurrence> => {
		if (!inScope(value)) {
			return [];
		}
		return occurrences.some(({ key }) => key === value.key) || !present.has(value.sourceEventId)
			? []
			: [
					{
						...value,
						written: null,
						status: value.status === "active" ? "inactive" : value.status,
					},
				];
	});
	return {
		changes,
		counted,
		history,
		boundaries: new Set(
			occurrences.flatMap((value) =>
				value.rule === "progress" && (value.status === "active" || value.status === "suppressed")
					? [value.sourceEventId]
					: [],
			),
		),
		value: {
			occurrences: sortedOccurrences([...occurrences, ...kept]),
			...(input.subject.episodic
				? {
						terminal: input.subject.terminal,
						...(waiting ? { waiting } : {}),
						...(counted ? { counted } : {}),
					}
				: {}),
		} satisfies MediaFoldValue,
		automatic: new Map(
			desired.flatMap((value) => {
				const actual = outputs.get(value.occurrence.key);
				return actual !== undefined && jsonValueEquals(written(actual), value.output)
					? [
							[
								actual.id,
								{ rule: value.occurrence.rule, sourceEventId: value.occurrence.sourceEventId },
							] as const,
						]
					: [];
			}),
		),
	};
});
