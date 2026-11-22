import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	FOLD_LIMITS,
	FoldAbsorbed,
	type FoldEventChange,
	FoldEventImage,
	FoldOutput,
	type FoldSubjectInput,
	type FoldSubjectOutput,
} from "@ryot-app/contract/modules/events/folds";
import type { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { AutomationExecutionId, EntityId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import { jsonByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sql } from "drizzle-orm";
import { type Array as Arr, Context, DateTime, Effect, Layer, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import { lifecycleActor, rootLifecycleCausation } from "#modules/automations/lifecycle/command";
import { eventMutation } from "#modules/changes/changes";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import type { EventMutation } from "#modules/events/mutations";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import { FoldScripts, FoldScriptsLive } from "#modules/scripts/executions/fold-scripts";
import { DatabaseSession } from "#platform/db/session";
import type { WriteTransaction } from "#platform/db/write-transaction";

import {
	type FoldDeclaration,
	type FoldEventRow,
	foldImage,
	foldJobKey,
	FoldMarks,
	type FoldRun,
	foldRunKey,
	type FoldSubject,
	foldSubjectOf,
	foldValuesSql,
	pendingFolds,
	readFoldEvents,
	sourceEntities,
} from "./marks";

export type FoldMode = "job" | "queue" | "inline";

export type QueuedResults = ReadonlyArray<{
	readonly prepared: Prepared;
	readonly item: FoldSubjectOutput;
}>;

/** Subjects of one fold that a fold job runs together, built without locks. */
export type QueuedRun = {
	readonly userId: UserId;
	readonly binding: Binding;
	readonly pluginId: PluginId;
	readonly subjects: ReadonlyArray<Prepared>;
};

export type ApplyFoldChanges = (
	transaction: WriteTransaction,
	input: {
		readonly userId: UserId;
		readonly command: DomainLifecycleCommand;
		readonly changes: ReadonlyArray<EventMutation>;
	},
) => Effect.Effect<void, unknown>;

type Binding = NonNullable<Effect.Success<ReturnType<FoldScripts["Service"]["resolve"]>>>;

type Target = {
	readonly id: string;
	readonly subjectEntityId: string;
	readonly propertiesSchema: AppSchema<unknown>;
};

type Changed = {
	readonly subject: FoldSubject;
	readonly command: DomainLifecycleCommand;
	readonly changes: ReadonlyArray<EventMutation>;
};

/**
 * A subject's input and its cost within a run's subject list, with the stored state it was built from:
 * the subject row's revision (-1 without one), whether a fold job has work for it, and whether it takes
 * stored changes.
 */
type Prepared = {
	readonly cost: number;
	readonly entry: FoldRun;
	readonly revision: number;
	readonly pending: boolean;
	readonly consumed: boolean;
	readonly input: FoldSubjectInput;
};

type OutputRow = {
	readonly value: JsonValue;
	readonly targetId: string;
	readonly expected: number;
	readonly subjectEntityId: string;
	readonly kind: "event" | "subject" | "relationship";
};

type StoredRow = {
	readonly value: JsonValue;
	readonly eventId: null | string;
	readonly replay: null | boolean;
	readonly revision: null | number;
	readonly subjectEntityId: string;
	readonly kind: "change" | "subject" | "absorbed";
	readonly status: null | "ready" | "failed" | "pending";
};

class FoldFailed extends Schema.TaggedError<FoldFailed, { readonly brand: unique symbol }>()(
	"FoldFailed",
	{ message: Schema.String },
) {}

const MAX_RUNS = 2;

const REBUILD_PAGE = 500;

// A subject costs its JSON bytes plus the separator before it; the first subject needs none.
const RUN_CAPACITY = FOLD_LIMITS.inputBytes - JSON.stringify({ subjects: [] }).length + 1;

const failure = (message: string) => new FoldFailed({ message });

const asDbError = Effect.mapError((error: { readonly message: string }) =>
	error instanceof DbError ? error : new DbError({ message: error.message }),
);

const costOf = (input: FoldSubjectInput) => {
	const bytes = jsonByteLength(input);
	return bytes === null || bytes + 1 > RUN_CAPACITY ? null : bytes + 1;
};

/** Packs subjects into runs first-fit by decreasing cost, each within the input bound and subject count. */
const pack = (prepared: ReadonlyArray<Prepared>) => {
	const runs: Array<{ cost: number; subjects: Array<Prepared> }> = [];
	for (const item of [...prepared].sort((left, right) => right.cost - left.cost)) {
		const run = runs.find(
			(candidate) =>
				candidate.subjects.length < FOLD_LIMITS.runSubjects &&
				candidate.cost + item.cost <= RUN_CAPACITY,
		);
		if (run) {
			run.cost += item.cost;
			run.subjects.push(item);
		} else {
			runs.push({ cost: item.cost, subjects: [item] });
		}
	}
	return runs.map(({ subjects }) =>
		subjects.sort((left, right) =>
			left.entry.subject.entityId.localeCompare(right.entry.subject.entityId),
		),
	);
};

/**
 * Joins a subject's stored changes to the transaction's: a stored change keeps its earlier image before,
 * and an event the transaction did not change pairs it with its image now when it still belongs here.
 */
const joinedChanges = (
	subjectEntityId: string,
	changes: ReadonlyArray<FoldEventChange>,
	stored: ReadonlyArray<{ readonly eventId: string; readonly before: null | FoldEventImage }>,
	now: ReadonlyMap<string, FoldEventRow>,
	known: ReadonlyMap<string, FoldDeclaration>,
) => {
	const byEvent = new Map<string, FoldEventChange>();
	for (const change of changes) {
		const image = change.after ?? change.before;
		if (image) {
			byEvent.set(image.id, change);
		}
	}
	for (const { before, eventId } of stored) {
		const current = byEvent.get(eventId);
		const image = now.get(eventId);
		let after = current?.after ?? null;
		if (!current && image && foldSubjectOf(image, known)?.entityId === subjectEntityId) {
			after = foldImage(image);
		}
		byEvent.set(eventId, { after, before });
	}
	return [...byEvent.values()].filter(
		({ after, before }) => stableStringify(before) !== stableStringify(after),
	);
};

const applyChanges = (
	transaction: WriteTransaction,
	changed: ReadonlyArray<Changed>,
	apply: ApplyFoldChanges,
) =>
	Effect.forEach(
		changed,
		({ subject, command, changes }) =>
			apply(transaction, { command, changes, userId: subject.userId }).pipe(
				Effect.mapError((error) =>
					failure(`Fold changes could not be applied: ${unknownToMessage(error)}`),
				),
			),
		{ discard: true },
	);

export class Folds extends Context.Service<Folds>()(
	"@ryot-app/kernel-backend/modules/derived-values/service/Folds",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const definitions = yield* DefinitionCatalog;
			const marks = yield* FoldMarks.make;
			const scripts = yield* FoldScripts;
			const calls = yield* ScriptCalls;
			const random = yield* SecureRandom.SecureRandom;

			const { route, collect, declarations, queuePending, queueResolved } = marks;

			const outputTargets = Effect.fn("Folds.outputTargets")(function* (
				userId: UserId,
				pluginId: PluginId,
				subjects: ReadonlyArray<FoldDeclaration>,
				outputs: ReadonlyArray<FoldSubjectOutput>,
			) {
				const catalog = yield* definitions.forUser(userId);
				const eventIds = outputs.flatMap((output) => output.events.map(({ eventId }) => eventId));
				const events =
					eventIds.length === 0
						? []
						: yield* readFoldEvents(
								session,
								sql`v.user_id = ${userId} and v.id in (${foldValuesSql(eventIds)})`,
							);
				const sessions = yield* declarations(userId, [
					...new Set(events.flatMap((row) => (row.sessionEntityId ? [row.sessionEntityId] : []))),
				]);
				const owners = new Map<string, FoldDeclaration>([
					...sessions,
					...subjects.map((declaration) => [declaration.entityId, declaration] as const),
				]);
				const eventTargets = new Map<string, Target>();
				for (const row of events) {
					const propertiesSchema = catalog.eventSchemas.find(
						(schema) =>
							schema.isEffective &&
							schema.slug === row.eventSchemaSlug &&
							schema.pluginId === pluginId &&
							schema.entitySchemaSlug === row.entitySchemaSlug,
					)?.projection?.propertiesSchema;
					const owner = foldSubjectOf(row, owners);
					if (propertiesSchema && owner) {
						eventTargets.set(row.id, {
							id: row.id,
							propertiesSchema,
							subjectEntityId: owner.entityId,
						});
					}
				}
				const relationshipIds = outputs.flatMap((output) =>
					output.relationships.map(({ relationshipId }) => relationshipId),
				);
				const relationshipRows =
					relationshipIds.length === 0
						? []
						: yield* session.run((db) =>
								db.execute<{ id: string; slug: string; sourceEntityId: string }>(
									sql`select r.id, r.relationship_schema_slug as slug, r.source_entity_id as "sourceEntityId"
									from relationship r
									where r.user_id = ${userId}
										and r.source_entity_id in (${foldValuesSql(subjects.map(({ entityId }) => entityId))})
										and r.relationship_schema_plugin_id = ${pluginId}
										and r.id in (${foldValuesSql(relationshipIds)})`,
									"objects",
								),
							);
				const relationshipTargets = new Map(
					relationshipRows.flatMap(({ id, slug, sourceEntityId }) => {
						const projection = catalog.relationshipSchemas.find(
							(schema) =>
								schema.isEffective && schema.slug === slug && schema.pluginId === pluginId,
						)?.projection;
						return projection
							? [
									[
										id,
										{
											id,
											subjectEntityId: sourceEntityId,
											propertiesSchema: projection.propertiesSchema,
										},
									] as const,
								]
							: [];
					}),
				);
				return { events: eventTargets, relationships: relationshipTargets };
			});

			const validated = Effect.fnUntraced(function* (
				kind: "event" | "relationship",
				subjectEntityId: string,
				targets: ReadonlyMap<string, Target>,
				outputs: ReadonlyArray<{ readonly id: string; readonly properties: unknown }>,
			) {
				if (new Set(outputs.map(({ id }) => id)).size !== outputs.length) {
					return yield* failure(`Fold returned more than one value for a ${kind}`);
				}
				return yield* Effect.forEach(outputs, (output) =>
					Effect.gen(function* () {
						const target = targets.get(output.id);
						if (target?.subjectEntityId !== subjectEntityId) {
							return yield* failure(`Fold returned a value for an unrelated ${kind}`);
						}
						const value = yield* parseAppSchemaProperties({
							kind: "Projection",
							properties: output.properties,
							propertiesSchema: target.propertiesSchema,
						}).pipe(
							Effect.flatMap(Schema.decodeUnknownEffect(JsonValue)),
							Effect.mapError(() => failure(`Fold returned invalid ${kind} properties`)),
						);
						return { kind, value, expected: 0, subjectEntityId, targetId: output.id };
					}),
				);
			});

			/**
			 * Locks the subjects' entity rows. Every write that changes their events holds them too, so no
			 * change joins a subject's stored list between a fold reading it and consuming it.
			 */
			const lockSubjects = (ids: ReadonlyArray<string>) =>
				session.run((db) =>
					db.execute(
						sql`select 1 from entity where id in (${foldValuesSql(ids)}) order by id for no key update`,
					),
				);

			/** Reads the subjects' rows, absorbed values and stored changes in one statement. */
			const readStored = (userId: UserId, ids: ReadonlyArray<string>) =>
				session.run((db) =>
					db.execute<StoredRow>(
						sql`select kind, value, status, revision, replay, subject_entity_id as "subjectEntityId",
							null::text as "eventId"
						from derived_value
						where user_id = ${userId} and subject_entity_id in (${foldValuesSql(ids)})
							and kind in ('subject', 'absorbed')
						union all
						select 'change', before, null, null, null, subject_entity_id, event_id
						from derived_change
						where user_id = ${userId} and subject_entity_id in (${foldValuesSql(ids)})
						order by 6, 7`,
						"objects",
					),
				);

			/**
			 * Builds each subject's input from its stored state and the transaction's changes, incremental
			 * when it can be. A commit locks its subjects first; a fold job reads them without locks.
			 */
			const prepare = Effect.fnUntraced(function* (
				userId: UserId,
				pluginId: PluginId,
				scriptSlug: string,
				entries: ReadonlyArray<FoldRun>,
				lock: boolean,
			) {
				const binding = yield* scripts.resolve({ userId, pluginId, scriptSlug });
				if (!binding) {
					return yield* failure("Fold script is unavailable");
				}
				const ids = entries.map(({ subject }) => subject.entityId).sort();
				if (lock) {
					yield* lockSubjects(ids);
				}
				const stored = yield* readStored(userId, ids);
				const changedHere = new Map<string, ReadonlySet<string>>(
					entries.map((entry) => [
						entry.subject.entityId,
						new Set<string>(
							(entry.changes ?? []).flatMap((change) => {
								const image = change.after ?? change.before;
								return image ? [image.id] : [];
							}),
						),
					]),
				);
				const unread = [
					...new Set(
						stored.flatMap((row) =>
							row.kind === "change" &&
							row.eventId !== null &&
							!changedHere.get(row.subjectEntityId)?.has(row.eventId)
								? [row.eventId]
								: [],
						),
					),
				];
				const images =
					unread.length === 0
						? []
						: yield* readFoldEvents(
								session,
								sql`v.user_id = ${userId} and v.id in (${foldValuesSql(unread)})`,
							);
				const known = new Map([
					...(images.length === 0
						? []
						: yield* declarations(userId, images.flatMap(sourceEntities))),
					...entries.map(({ declaration }) => [declaration.entityId, declaration] as const),
				]);
				const now = new Map(images.map((row) => [row.id, row]));
				const prepared = yield* Effect.forEach(entries, (entry) =>
					Effect.gen(function* () {
						const rows = stored.filter((row) => row.subjectEntityId === entry.subject.entityId);
						const absorbed = yield* Effect.forEach(
							rows.filter((row) => row.kind === "absorbed"),
							(row) =>
								Schema.decodeUnknownEffect(FoldAbsorbed)(row.value).pipe(
									Effect.mapError(() => failure("Absorbed fold value is invalid")),
								),
						);
						const queued = yield* Effect.forEach(
							rows.filter((row) => row.kind === "change"),
							(row) =>
								Schema.decodeUnknownEffect(Schema.NullOr(FoldEventImage))(row.value).pipe(
									Effect.mapBoth({
										onFailure: () => failure("Stored fold change is invalid"),
										onSuccess: (before) => ({ before, eventId: row.eventId ?? "" }),
									}),
								),
						);
						const own = rows.find((row) => row.kind === "subject");
						const replay = {
							absorbed,
							changes: null,
							value: own?.value ?? null,
							subjectEntityId: entry.subject.entityId,
						};
						const replayCost = costOf(replay);
						if (replayCost === null) {
							return yield* failure(`Fold input exceeds ${FOLD_LIMITS.inputBytes} UTF-8 bytes`);
						}
						const state = {
							entry,
							consumed: queued.length > 0,
							revision: own?.revision ?? -1,
							pending: own?.status === "pending",
						};
						const changes =
							own && !own.replay && absorbed.length === 0 && entry.changes !== null
								? joinedChanges(entry.subject.entityId, entry.changes, queued, now, known)
								: null;
						if (changes !== null && changes.length <= FOLD_LIMITS.inputChanges) {
							const incremental = { ...replay, changes };
							const cost = costOf(incremental);
							if (cost !== null) {
								return { ...state, cost, input: incremental };
							}
						}
						return { ...state, input: replay, cost: replayCost };
					}),
				);
				return { binding, prepared };
			});

			/**
			 * Writes a run's outputs: replayed subjects replace theirs, incremental ones patch them. A subject
			 * becomes ready and drops its stored changes only while its row is at the revision it was read
			 * at; a mark since keeps it pending for the job that mark queued.
			 */
			const write = Effect.fnUntraced(function* (
				userId: UserId,
				pluginId: PluginId,
				revision: string,
				subjects: ReadonlyArray<{
					readonly entityId: string;
					readonly consumed: boolean;
					readonly rows: ReadonlyArray<OutputRow>;
					readonly changes: FoldSubjectInput["changes"];
				}>,
			) {
				const rows = subjects.flatMap((subject) => subject.rows);
				const replayed = subjects.flatMap(({ changes, entityId }) =>
					changes === null ? [entityId] : [],
				);
				const patched = subjects.flatMap(({ changes, entityId }) =>
					changes === null ? [] : [entityId],
				);
				const consumed = subjects.flatMap(({ entityId, consumed: taken }) =>
					taken ? [entityId] : [],
				);
				if (replayed.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`delete from derived_value where user_id = ${userId}
							and subject_entity_id in (${foldValuesSql(replayed)}) and kind <> 'subject'
							and (kind, target_id) not in (select * from jsonb_to_recordset(${JSON.stringify(
								rows.map((row) => ({ kind: row.kind, targetId: row.targetId })),
							)}::jsonb) as r(kind text, "targetId" text))`),
					);
				}
				if (patched.length > 0) {
					const removed = subjects.flatMap(({ changes, entityId }) =>
						(changes ?? []).flatMap((change) =>
							change.before && !change.after ? [{ entityId, targetId: change.before.id }] : [],
						),
					);
					if (removed.length > 0) {
						yield* session.run((db) =>
							db.execute(sql`delete from derived_value where user_id = ${userId} and kind = 'event'
								and (subject_entity_id, target_id) in (select * from jsonb_to_recordset(${JSON.stringify(
									removed,
								)}::jsonb) as r("entityId" text, "targetId" text))`),
						);
					}
					yield* session.run((db) =>
						db.execute(sql`delete from derived_value v where v.user_id = ${userId}
							and v.subject_entity_id in (${foldValuesSql(patched)}) and v.kind = 'relationship'
							and not exists (select 1 from relationship r where r.id = v.target_id
								and r.source_entity_id = v.subject_entity_id)`),
					);
				}
				if (consumed.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`delete from derived_change where user_id = ${userId}
							and subject_entity_id in (${foldValuesSql(consumed)})`),
					);
				}
				yield* session.run((db) =>
					db.execute(sql`
						insert into derived_value as v
							(user_id, kind, target_id, subject_entity_id, plugin_id, plugin_revision_id, value, status, revision, updated_at)
						select ${userId}, r.kind, r."targetId", r."subjectEntityId", ${pluginId}, ${revision},
							coalesce(r.value, 'null'::jsonb), 'ready', r.expected + 1, now()
						from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
							as r(kind text, "targetId" text, "subjectEntityId" text, value jsonb, expected integer)
						order by 2, 3
						on conflict (user_id, kind, target_id) do update set value = excluded.value,
							status = case when v.revision = excluded.revision - 1 then 'ready' else v.status end,
							replay = v.replay and v.revision <> excluded.revision - 1,
							revision = v.revision + 1, subject_entity_id = excluded.subject_entity_id,
							plugin_revision_id = excluded.plugin_revision_id, updated_at = now()
						where v.value is distinct from excluded.value or v.status <> 'ready' or v.replay
							or v.subject_entity_id <> excluded.subject_entity_id
							or v.plugin_revision_id <> excluded.plugin_revision_id
					`),
				);
			});

			const commandOf = Effect.fnUntraced(function* (
				subject: FoldSubject,
				writeContext: DomainLifecycleCommand["writeContext"],
				lane: ExecutionLane,
			) {
				const actor = lifecycleActor({ userId: subject.userId });
				return {
					writeContext,
					accountUserId: actor.accountUserId,
					itemIdentity: `fold:${subject.entityId}`,
					occurredAt: DateTime.formatIso(yield* DateTime.now),
					causation: rootLifecycleCausation({
						lane,
						source: "api",
						initiator: actor.initiator,
						executionId: AutomationExecutionId.make(`fold:${subject.userId}:${subject.entityId}`),
					}),
				} satisfies DomainLifecycleCommand;
			});

			/** Runs the fold once over subjects that fit one run and pairs each with its result. */
			const execute = Effect.fnUntraced(function* (
				binding: Binding,
				subjects: ReadonlyArray<Prepared>,
				lane: ExecutionLane,
			) {
				const result = yield* calls.run({
					lane,
					principal: binding.principal,
					executionId: `fold-${yield* random.uuidV4()}`,
					input: { subjects: subjects.map(({ input }) => input) },
				});
				if (result.error) {
					return yield* failure(
						`Fold failed with ${result.error.kind} during ${result.error.phase}: ${result.error.message}`,
					);
				}
				const output = yield* Schema.decodeUnknownEffect(FoldOutput)(result.value).pipe(
					Effect.mapError((error) => failure(`Fold output is invalid: ${unknownToMessage(error)}`)),
				);
				if (output.subjects.length !== subjects.length) {
					return yield* failure("Fold must return one result per subject");
				}
				return yield* Effect.forEach(subjects, (prepared) => {
					const item = output.subjects.find(
						({ subjectEntityId }) => subjectEntityId === prepared.entry.subject.entityId,
					);
					return item
						? Effect.succeed({ item, prepared })
						: failure("Fold must return one result per subject");
				});
			});

			/** Validates and writes a run's results, returning the changes each subject asked for. */
			const persist = Effect.fnUntraced(function* (
				userId: UserId,
				pluginId: PluginId,
				binding: Binding,
				lane: ExecutionLane,
				results: QueuedResults,
			) {
				const changed: Array<Changed> = [];
				if (results.length === 0) {
					return changed;
				}
				const found = yield* outputTargets(
					userId,
					pluginId,
					results.map(({ prepared }) => prepared.entry.declaration),
					results.map(({ item }) => item),
				);
				const writes = [];
				for (const { item, prepared } of results) {
					const { subject } = prepared.entry;
					if (
						new TextEncoder().encode(stableStringify(item.value)).length > FOLD_LIMITS.valueBytes
					) {
						return yield* failure("Fold value exceeds its size limit");
					}
					const rows: Array<OutputRow> = [
						{
							kind: "subject",
							value: item.value,
							targetId: subject.entityId,
							expected: prepared.revision,
							subjectEntityId: subject.entityId,
						},
						...(yield* validated(
							"event",
							subject.entityId,
							found.events,
							item.events.map(({ eventId, properties }) => ({ properties, id: eventId })),
						)),
						...(yield* validated(
							"relationship",
							subject.entityId,
							found.relationships,
							item.relationships.map(({ properties, relationshipId }) => ({
								properties,
								id: relationshipId,
							})),
						)),
					];
					const changes = yield* Effect.forEach(item.changes, (change) =>
						eventMutation(change, (reference) =>
							reference.kind === "existing"
								? Effect.succeed(reference.entityId)
								: Effect.fail(failure("Fold event creates name existing entities")),
						),
					);
					writes.push({
						rows,
						entityId: subject.entityId,
						consumed: prepared.consumed,
						changes: prepared.input.changes,
					});
					if (changes.length > 0) {
						changed.push({
							subject,
							changes,
							command: yield* commandOf(subject, binding.principal, lane),
						});
					}
				}
				yield* write(userId, pluginId, binding.pluginPin.revisionId, writes);
				return changed;
			});

			/** Folds one fold's subjects in as few runs as fit, under their locks, returning the changes each asked for. */
			const runFold = Effect.fn("Folds.runFold")(function* (
				entries: Arr.NonEmptyReadonlyArray<FoldRun>,
				lane: ExecutionLane,
			) {
				const [
					{
						subject: { userId },
						declaration: { pluginId, scriptSlug },
					},
				] = entries;
				const { binding, prepared } = yield* prepare(userId, pluginId, scriptSlug, entries, true);
				const changed: Array<Changed> = [];
				for (const subjects of pack(prepared)) {
					changed.push(
						...(yield* persist(
							userId,
							pluginId,
							binding,
							lane,
							yield* execute(binding, subjects, lane),
						)),
					);
				}
				return changed;
			});

			/** Runs each fold once over every subject a transaction collected, applies their changes, and repeats until none remain. */
			const settle = Effect.fn("Folds.settle")(function* (
				transaction: WriteTransaction,
				apply: ApplyFoldChanges,
				mode: Exclude<FoldMode, "queue">,
			) {
				const lane = mode === "job" ? "background" : "interactive";
				const pending = pendingFolds(transaction);
				const { runs } = pending;
				for (
					let resolved = yield* collect(transaction);
					resolved.length > 0;
					resolved = yield* collect(transaction)
				) {
					const byFold = new Map<string, Arr.NonEmptyArray<FoldRun>>();
					for (const entry of resolved) {
						const key = foldRunKey(entry);
						const entries = byFold.get(key);
						if (entries) {
							entries.push(entry);
						} else {
							byFold.set(key, [entry]);
						}
						const subject = foldJobKey(entry.subject);
						runs.set(subject, (runs.get(subject) ?? 0) + 1);
					}
					const changed = [];
					for (const entries of byFold.values()) {
						changed.push(...(yield* runFold(entries, lane)));
					}
					yield* changed.some(({ subject }) => (runs.get(foldJobKey(subject)) ?? 0) >= MAX_RUNS)
						? failure("Fold kept changing its own events")
						: applyChanges(transaction, changed, apply);
				}
			}, asDbError);

			/** Builds the runs of a fold job's subjects that still have work, from their stored state and without locks. */
			const prepareQueued = Effect.fn("Folds.prepareQueued")(function* (input: {
				readonly userId: UserId;
				readonly entityIds: ReadonlyArray<EntityId>;
			}) {
				const resolved = yield* route({
					sources: [],
					subjects: input.entityIds.map((entityId) => ({ entityId, userId: input.userId })),
				});
				const byFold = new Map<string, Arr.NonEmptyArray<FoldRun>>();
				for (const entry of resolved) {
					const key = foldRunKey(entry);
					const queued: FoldRun = { ...entry, changes: [] };
					const entries = byFold.get(key);
					if (entries) {
						entries.push(queued);
					} else {
						byFold.set(key, [queued]);
					}
				}
				const runs: Array<QueuedRun> = [];
				for (const entries of byFold.values()) {
					const { pluginId, scriptSlug } = entries[0].declaration;
					const { binding, prepared } = yield* prepare(
						input.userId,
						pluginId,
						scriptSlug,
						entries,
						false,
					);
					for (const subjects of pack(prepared.filter(({ pending }) => pending))) {
						runs.push({ binding, pluginId, subjects, userId: input.userId });
					}
				}
				return runs;
			}, asDbError);

			/** Runs a fold job's run outside any transaction. */
			const runQueued = Effect.fn("Folds.runQueued")(function* (run: QueuedRun) {
				return yield* execute(run.binding, run.subjects, "background");
			}, asDbError);

			/**
			 * Writes a fold job's results for the subjects still at the revisions the run was built from, under
			 * their locks, and applies the changes they asked for; returns the subjects that changed since.
			 */
			const commitQueued = Effect.fn("Folds.commitQueued")(function* (
				transaction: WriteTransaction,
				run: QueuedRun,
				results: QueuedResults,
				apply: ApplyFoldChanges,
			) {
				const ids = run.subjects.map(({ entry }) => entry.subject.entityId).sort();
				yield* lockSubjects(ids);
				const current = new Map(
					(yield* session.run((db) =>
						db.execute<{ targetId: string; revision: number }>(
							sql`select target_id as "targetId", revision from derived_value
							where user_id = ${run.userId} and kind = 'subject' and target_id in (${foldValuesSql(ids)})`,
							"objects",
						),
					)).map((row) => [row.targetId, row.revision]),
				);
				const matched = results.filter(
					({ prepared }) => current.get(prepared.entry.subject.entityId) === prepared.revision,
				);
				const { runs } = pendingFolds(transaction);
				for (const { prepared } of matched) {
					runs.set(foldJobKey(prepared.entry.subject), 1);
				}
				yield* applyChanges(
					transaction,
					yield* persist(run.userId, run.pluginId, run.binding, "background", matched),
					apply,
				);
				return results.flatMap(({ prepared }) =>
					matched.some((entry) => entry.prepared === prepared)
						? []
						: [prepared.entry.subject.entityId],
				);
			}, asDbError);

			/** Marks a subject's last fold job failed; its next fold replays in full. */
			const failed = Effect.fn("Folds.failed")(function* (subject: FoldSubject) {
				yield* session.run((db) =>
					db.execute(sql`update derived_value set status = 'failed', replay = true,
						revision = revision + 1, updated_at = now()
						where user_id = ${subject.userId} and kind = 'subject' and target_id = ${subject.entityId}`),
				);
			});

			const subjectsOfPlugin = Effect.fn("Folds.subjectsOfPlugin")(function* (input: {
				userId: UserId;
				pluginId: PluginId;
				after: null | string;
				projectedRelationships: ReadonlyArray<string>;
			}) {
				const rows = yield* session.run((db) =>
					db.execute<{
						entityId: string;
						eventSchemaSlug: null | string;
						sessionEntityId: null | string;
						hasProjectedRelationship: boolean;
					}>(
						sql`with relationship_subjects as (
							select distinct source_entity_id as entity_id from relationship
							where user_id = ${input.userId} and relationship_schema_plugin_id = ${input.pluginId}
								and relationship_schema_slug in (${foldValuesSql(input.projectedRelationships)})
						), page as (
							select entity_id from (
								select entity_id from event
								where user_id = ${input.userId} and event_schema_plugin_id = ${input.pluginId}
								union select entity_id from relationship_subjects
							) subjects
							where ${input.after}::text is null or entity_id > ${input.after}
							order by entity_id limit ${REBUILD_PAGE}
						)
						select distinct page.entity_id as "entityId", v.session_entity_id as "sessionEntityId",
							v.event_schema_slug as "eventSchemaSlug", r.entity_id is not null as "hasProjectedRelationship"
						from page left join relationship_subjects r on r.entity_id = page.entity_id
						left join event v on v.entity_id = page.entity_id
							and v.user_id = ${input.userId} and v.event_schema_plugin_id = ${input.pluginId}
						order by 1`,
						"objects",
					),
				);
				const resolved = yield* route({
					subjects: rows
						.filter((row) => row.hasProjectedRelationship)
						.map((row) => ({ userId: input.userId, entityId: EntityId.make(row.entityId) })),
					sources: rows.flatMap((row) =>
						row.eventSchemaSlug === null
							? []
							: [
									{
										userId: input.userId,
										entityId: row.entityId,
										eventSchemaPluginId: input.pluginId,
										sessionEntityId: row.sessionEntityId,
										eventSchemaSlug: row.eventSchemaSlug,
									},
								],
					),
				});
				const entities = new Set(rows.map((row) => row.entityId));
				return {
					resolved,
					after: entities.size < REBUILD_PAGE ? null : (rows.at(-1)?.entityId ?? null),
				};
			});

			const rebuild = Effect.fn("Folds.rebuild")(function* (input: {
				userId: UserId;
				pluginId: PluginId;
			}) {
				const projectedRelationships = (yield* definitions.forUser(
					input.userId,
				)).relationshipSchemas
					.filter(
						(schema) =>
							schema.isEffective &&
							schema.pluginId === input.pluginId &&
							schema.projection !== null,
					)
					.map((schema) => schema.slug);
				let after: null | string = null;
				do {
					const page = yield* session
						.transaction(
							Effect.gen(function* () {
								const found = yield* subjectsOfPlugin({ ...input, after, projectedRelationships });
								yield* queueResolved(found.resolved);
								return found.after;
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
					after = page;
				} while (after !== null);
			});

			return {
				failed,
				settle,
				rebuild,
				runQueued,
				commitQueued,
				prepareQueued,
				queue: queuePending,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(FoldScriptsLive, DefinitionCatalog.layer)),
	);
}
