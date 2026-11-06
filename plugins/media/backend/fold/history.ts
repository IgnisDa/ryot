import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import { jsonValueEquals } from "@ryot-app/plugin-kit/schema";

import { ConsumptionBasis } from "../../shared/consumption";
import { isPositional, positionalProperties } from "../../shared/media-schema-slugs";

export type FoldEvent = {
	readonly id: string;
	readonly revision: number;
	readonly entityId: string;
	readonly orderKey: string;
	readonly occurredAt: string;
	readonly orderCreatedAt: string;
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly sessionEntityId: null | string;
	readonly properties: Readonly<Record<string, JsonValue>>;
};

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
	total: Schema.optionalKey(Schema.Finite),
	rule: Schema.Literals(["progress", "coverage"]),
	sources: Schema.optionalKey(Schema.Array(Schema.String)),
	inventory: Schema.optionalKey(Schema.Array(Schema.String)),
	status: Schema.Literals(["active", "inactive", "suppressed", "overridden"]),
});
export type Occurrence = typeof Occurrence.Type;

export const MediaFoldValue = Schema.Struct({
	occurrences: Schema.Array(Occurrence),
	terminal: Schema.optionalKey(Schema.Boolean),
	coverageSources: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type MediaFoldValue = typeof MediaFoldValue.Type;

/**
 * Takes on the occurrences of subjects merged or restored into this one, so what a user suppressed and the
 * inventories frozen there carry over. Their outputs are compared afresh, because their IDs changed.
 */
export const absorbFoldValues = (
	previous: MediaFoldValue,
	absorbed: ReadonlyArray<{
		readonly value: MediaFoldValue;
		readonly ids: Readonly<Record<string, string>>;
	}>,
) => {
	const occurrences = new Map(previous.occurrences.map((value) => [value.key, value]));
	const coverageSources = new Set(previous.coverageSources ?? []);
	const renamedKeys = new Map<string, string>();
	for (const { ids, value } of absorbed) {
		const id = (token: string) => ids[token] ?? token;
		const list = (tokens: ReadonlyArray<string>) => tokens.map(id);
		for (const occurrence of value.occurrences) {
			const key = occurrence.key.split(":").map(id).join(":");
			renamedKeys.set(occurrence.key, key);
			if (!occurrences.has(key)) {
				occurrences.set(key, {
					...occurrence,
					key,
					written: null,
					sourceEventId: id(occurrence.sourceEventId),
					...(occurrence.sources ? { sources: list(occurrence.sources) } : {}),
					...(occurrence.inventory ? { inventory: list(occurrence.inventory) } : {}),
				});
			}
		}
		for (const source of value.coverageSources ?? []) {
			coverageSources.add(id(source));
		}
	}
	return {
		renamedKeys,
		value: {
			...previous,
			occurrences: [...occurrences.values()],
			...(coverageSources.size > 0 ? { coverageSources: [...coverageSources].sort() } : {}),
		} satisfies MediaFoldValue,
	};
};

export type HistoryChange =
	| { readonly kind: "delete"; readonly eventId: string; readonly itemIdentity: string }
	| {
			readonly kind: "create";
			readonly itemIdentity: string;
			readonly item: {
				readonly entityId: string;
				readonly occurredAt: string;
				readonly sessionEntityId?: string;
				readonly eventSchemaSlug: "complete";
				readonly properties: Readonly<Record<string, JsonValue>>;
				readonly orderAfter: { readonly suffix: string; readonly eventId: string };
			};
	  }
	| {
			readonly kind: "update";
			readonly itemIdentity: string;
			readonly item: {
				readonly eventId: string;
				readonly patch: {
					readonly occurredAt?: string;
					readonly orderAfter: null | { readonly suffix: string; readonly eventId: string };
					readonly properties: {
						readonly remove: ReadonlyArray<string>;
						readonly set: Readonly<Record<string, JsonValue>>;
					};
				};
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

const statusOf = (prior: undefined | Occurrence): Occurrence["status"] =>
	prior === undefined || prior.status === "inactive" ? "active" : prior.status;

/** History order: occurrence time, source creation time, then source order key and ID. */
export const compareHistory = (left: FoldEvent, right: FoldEvent) =>
	time(left.occurredAt) - time(right.occurredAt) ||
	time(left.orderCreatedAt) - time(right.orderCreatedAt) ||
	compareText(left.orderKey, right.orderKey) ||
	compareText(left.id, right.id);

const completionKeyOf = (event: FoldEvent) => {
	const key = event.properties["completionKey"];
	return event.eventSchemaSlug === "complete" && typeof key === "string" ? key : undefined;
};

const written = (event: FoldEvent): WrittenOutput => ({
	entityId: event.entityId,
	orderKey: event.orderKey,
	properties: event.properties,
	sessionEntityId: event.sessionEntityId,
	occurredAt: new Date(time(event.occurredAt)).toISOString(),
	orderCreatedAt: new Date(time(event.orderCreatedAt)).toISOString(),
});

const optional = (key: string, value: JsonValue | undefined, keep: boolean) =>
	keep && value !== undefined ? { [key]: value } : {};

const positive = (value: JsonValue | undefined) =>
	typeof value === "number" && value > 0 ? value : 0;

const sourceRunOf = (event: FoldEvent) => {
	const run = event.properties["sourceRun"];
	return typeof run === "string" ? run : null;
};

/**
 * Derives a subject's automatic completions from its history and its previous fold value. Progress
 * that reaches its total completes its item; complete coverage of an episodic subject's required
 * episodes completes the subject. A deleted automatic completion stays suppressed and an edited one
 * becomes explicit. Coverage completions keep the episode inventory they were frozen with. A new one
 * needs a completion this fold has not seen or a subject that just became terminal: an inventory change
 * alone completes nothing.
 */
export const deriveHistory = Effect.fn("deriveHistory")(function* <E, R>(input: {
	readonly subject: HistorySubject;
	readonly previous: MediaFoldValue;
	readonly events: ReadonlyArray<FoldEvent>;
	/** Completions restored under a key whose source has since changed ID still answer to that occurrence. */
	readonly renamedKeys?: ReadonlyMap<string, string>;
	readonly inventory: Effect.Effect<ReadonlyArray<string>, E, R>;
}) {
	const changes: Array<HistoryChange> = [];
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
		if (value.status !== "active" || value.written === null) {
			continue;
		}
		const actual = outputs.get(value.key);
		if (actual === undefined) {
			previous.set(value.key, { ...value, written: null, status: "suppressed" });
		} else if (!jsonValueEquals(written(actual), value.written)) {
			overridden.add(actual.id);
			outputs.delete(value.key);
			previous.set(value.key, { ...value, written: null, status: "overridden" });
			changes.push({
				kind: "update",
				itemIdentity: `override:${actual.id}`,
				item: {
					eventId: actual.id,
					patch: {
						orderAfter: null,
						properties: { set: {}, remove: ["completionKey", "completionSilent"] },
					},
				},
			});
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
		const position = positional ? positionalProperties[source.entitySchemaSlug] : undefined;
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
			(source.properties["progressPercent"] === 100 ||
				(total > 0 && positive(source.properties["progressPages"]) >= total) ||
				(position !== undefined &&
					total > 0 &&
					positive(source.properties[position.position]) >= total)) &&
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
					...optional(
						"consumedOn",
						source.properties["consumedOn"],
						typeof source.properties["consumedOn"] === "string",
					),
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

	const coverageSources = new Set<string>();
	if (input.subject.episodic) {
		let live: undefined | ReadonlyArray<string>;
		const used = new Set<string>();
		const frozen = input.previous.occurrences.filter(
			(value) => value.rule === "coverage" && value.inventory !== undefined,
		);
		let coverage = new Map<string, { source: string; event: FoldEvent }>();
		let basis: undefined | Occurrence;
		const seenSources = new Set(input.previous.coverageSources);
		const becameTerminal = input.subject.terminal && input.previous.terminal !== true;
		for (const event of effective) {
			if (event.eventSchemaSlug !== "progress" && event.eventSchemaSlug !== "complete") {
				continue;
			}
			if (event.entityId === input.subject.id) {
				if (event.eventSchemaSlug === "complete" && completionKeyOf(event) === undefined) {
					coverage = new Map();
					basis = undefined;
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
			const source = progressSource?.id ?? event.id;
			const unseen = !seenSources.has(source);
			coverageSources.add(source);
			coverage.set(event.entityId, { event, source });
			basis ??= frozen.find(
				(value) => !used.has(value.key) && value.sources?.includes(source) === true,
			);
			const supported = (value: Occurrence) =>
				(value.inventory ?? []).some((episodeId) => {
					const covered = coverage.get(episodeId);
					return covered !== undefined && value.sources?.includes(covered.source) === true;
				});
			if (basis !== undefined && !supported(basis)) {
				basis = undefined;
			}
			const required = basis?.inventory ?? (live ??= [...(yield* input.inventory)].sort());
			const covered = required.flatMap((episodeId) => {
				const value = coverage.get(episodeId);
				return value === undefined ? [] : [value];
			});
			if (
				required.length === 0 ||
				covered.length !== required.length ||
				(!input.subject.terminal && basis === undefined)
			) {
				continue;
			}
			const key = basis?.key ?? `coverage:${source}`;
			const prior = previous.get(key);
			if (basis === undefined && prior === undefined && !unseen && !becameTerminal) {
				continue;
			}
			used.add(key);
			const consumedOn = new Set(covered.map(({ event: item }) => item.properties["consumedOn"]));
			const [onlyConsumedOn] = consumedOn;
			const dateUnknown = covered.every(
				({ event: item }) => item.properties["dateUnknown"] === true,
			);
			const anchor = progressSource ?? event;
			occurrences.push(
				output(
					{
						key,
						written: null,
						rule: "coverage",
						sourceEventId: source,
						status: statusOf(prior),
						inventory: [...required],
						sources: covered.map((value) => value.source),
						silent: prior?.silent ?? anchor.revision !== 0,
					},
					anchor,
					event,
					"parent",
					{ entityId: input.subject.id, sessionEntityId: input.subject.id },
					{
						consumptionBasis: { unit: "episodes" },
						...optional(
							"consumedOn",
							onlyConsumedOn,
							consumedOn.size === 1 && typeof onlyConsumedOn === "string",
						),
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
			basis = undefined;
		}
	}

	const wanted = new Map(desired.map((value) => [value.occurrence.key, value]));
	for (const [key, actual] of outputs) {
		// A completion merged in from another title was never this fold's to remove.
		if (!wanted.has(key) && previous.has(key)) {
			changes.push({ kind: "delete", eventId: actual.id, itemIdentity: `remove:${actual.id}` });
		}
	}
	for (const value of desired) {
		const actual = outputs.get(value.occurrence.key);
		const orderAfter = { suffix: value.suffix, eventId: value.anchor.id };
		if (actual === undefined) {
			changes.push({
				kind: "create",
				itemIdentity: `complete:${value.occurrence.key}`,
				item: {
					orderAfter,
					eventSchemaSlug: "complete",
					entityId: value.output.entityId,
					occurredAt: value.output.occurredAt,
					properties: value.output.properties,
					...(value.output.sessionEntityId === null
						? {}
						: { sessionEntityId: value.output.sessionEntityId }),
				},
			});
		} else if (!jsonValueEquals(written(actual), value.output)) {
			changes.push({
				kind: "update",
				itemIdentity: `repair:${actual.id}`,
				item: {
					eventId: actual.id,
					patch: {
						orderAfter,
						occurredAt: value.output.occurredAt,
						properties: {
							set: value.output.properties,
							remove: Object.keys(actual.properties).filter(
								(key) => !Object.hasOwn(value.output.properties, key),
							),
						},
					},
				},
			});
		}
	}
	const present = new Set(history.map(({ id }) => id));
	const kept = [...previous.values()].flatMap((value): ReadonlyArray<Occurrence> => {
		const sources = value.rule === "progress" ? [value.sourceEventId] : (value.sources ?? []);
		return occurrences.some(({ key }) => key === value.key) ||
			!sources.some((id) => present.has(id))
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
		history,
		boundaries: new Set(
			occurrences.flatMap((value) =>
				value.rule === "progress" && (value.status === "active" || value.status === "suppressed")
					? [value.sourceEventId]
					: [],
			),
		),
		value: {
			occurrences: [...occurrences, ...kept],
			...(input.subject.episodic
				? { terminal: input.subject.terminal, coverageSources: [...coverageSources].sort() }
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
