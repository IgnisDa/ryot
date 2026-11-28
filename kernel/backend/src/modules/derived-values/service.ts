import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	FOLD_LIMITS,
	FoldAbsorbed,
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
import { Array as Arr, Context, DateTime, Effect, Layer, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import { lifecycleActor, rootLifecycleCommand } from "#modules/automations/lifecycle/command";
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
	FoldMarks,
	foldRunKey,
	type FoldSubject,
	foldSubjectOf,
	foldValuesSql,
	readFoldEvents,
	type ResolvedFold,
	sourceEntities,
} from "./marks";

/** Whether a write folds the subjects it queued right after its commit or leaves them to their jobs. */
export type FoldMode = "eager" | "queue";

export type ApplyFoldChanges = (
	transaction: WriteTransaction,
	input: {
		readonly userId: UserId;
		readonly command: DomainLifecycleCommand;
		readonly changes: ReadonlyArray<EventMutation>;
	},
) => Effect.Effect<void, unknown>;

/**
 * How a fold writes its results: `commit` runs a transaction that queues whatever its writes change
 * and returns the subjects it queued, and `apply` applies a fold's event changes in it.
 */
export type FoldWriter = {
	readonly apply: ApplyFoldChanges;
	readonly commit: <A>(
		work: (transaction: WriteTransaction) => Effect.Effect<A, DbError>,
	) => Effect.Effect<{ readonly value: A; readonly queued: ReadonlyArray<FoldSubject> }, DbError>;
};

/** A stored change a run read, at the version it read. */
type Consumed = { readonly eventId: string; readonly version: number };

type Binding = NonNullable<Effect.Success<ReturnType<FoldScripts["Service"]["resolve"]>>>;

type Results = ReadonlyArray<{ readonly prepared: Prepared; readonly item: FoldSubjectOutput }>;

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

/** Subjects of one fold that one script run folds together. */
type Run = {
	readonly userId: UserId;
	readonly binding: Binding;
	readonly pluginId: PluginId;
	readonly subjects: ReadonlyArray<Prepared>;
};

type OutputRow = {
	readonly value: JsonValue;
	readonly targetId: string;
	readonly subjectEntityId: string;
	readonly kind: "event" | "relationship";
};

/**
 * A subject's input and its cost within a run's subject list, with the stored state it was built from:
 * the subject row's revision and value version, and the absorbed values and changes it consumes.
 */
type Prepared = {
	readonly cost: number;
	readonly version: number;
	readonly revision: number;
	readonly entry: ResolvedFold;
	readonly input: FoldSubjectInput;
	readonly absorbed: ReadonlyArray<string>;
	readonly consumed: ReadonlyArray<Consumed>;
};

type StoredRow = {
	readonly version: number;
	readonly value: JsonValue;
	readonly targetId: string;
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

const subjectIds = (results: Results) =>
	results.map(({ prepared }) => prepared.entry.subject.entityId);

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

			const { route, declarations, queuePending, queueResolved } = marks;

			const outputTargets = Effect.fn("Folds.outputTargets")(function* (
				transaction: WriteTransaction,
				userId: UserId,
				pluginId: PluginId,
				subjects: ReadonlyArray<FoldDeclaration>,
				outputs: ReadonlyArray<FoldSubjectOutput>,
			) {
				const catalog = yield* definitions.forUser(userId, transaction);
				const eventIds = outputs.flatMap((output) => output.events.map(({ eventId }) => eventId));
				const events =
					eventIds.length === 0
						? []
						: yield* readFoldEvents(
								session,
								sql`v.user_id = ${userId} and v.id in (${foldValuesSql(eventIds)})`,
							);
				const sessions = yield* declarations(
					userId,
					[...new Set(events.flatMap((row) => (row.sessionEntityId ? [row.sessionEntityId] : [])))],
					transaction,
				);
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
						return { kind, value, subjectEntityId, targetId: output.id } satisfies OutputRow;
					}),
				);
			});

			/**
			 * Locks the subjects' entity rows, as every write that changes their events does first, so
			 * writing a fold's results waits behind those writes instead of deadlocking with them.
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
						sql`select kind, value, status, revision, replay, value_version as version,
							subject_entity_id as "subjectEntityId", target_id as "targetId"
						from derived_value
						where user_id = ${userId} and subject_entity_id in (${foldValuesSql(ids)})
							and kind in ('subject', 'absorbed')
						union all
						select 'change', before, null, null, null, version, subject_entity_id, event_id
						from derived_change
						where user_id = ${userId} and subject_entity_id in (${foldValuesSql(ids)})
						order by 7, 8`,
						"objects",
					),
				);

			/**
			 * Builds the runs of one fold's pending subjects from their stored state, without locks: a
			 * stored change keeps its image before, its image after is the event now while it still
			 * belongs to the subject, and a change whose two images are equal drops out of the list.
			 */
			const prepare = Effect.fnUntraced(function* (
				userId: UserId,
				entries: Arr.NonEmptyReadonlyArray<ResolvedFold>,
			) {
				const [
					{
						declaration: { pluginId, scriptSlug },
					},
				] = entries;
				const binding = yield* scripts.resolve({ userId, pluginId, scriptSlug });
				if (!binding) {
					return yield* failure("Fold script is unavailable");
				}
				const stored = yield* readStored(
					userId,
					entries.map(({ subject }) => subject.entityId).sort(),
				);
				const changed = [
					...new Set(stored.flatMap((row) => (row.kind === "change" ? [row.targetId] : []))),
				];
				const images =
					changed.length === 0
						? []
						: yield* readFoldEvents(
								session,
								sql`v.user_id = ${userId} and v.id in (${foldValuesSql(changed)})`,
							);
				const known = new Map([
					...(images.length === 0
						? []
						: yield* declarations(userId, images.flatMap(sourceEntities))),
					...entries.map(({ declaration }) => [declaration.entityId, declaration] as const),
				]);
				const now = new Map<string, FoldEventRow>(images.map((row) => [row.id, row]));
				const prepared = yield* Effect.forEach(entries, (entry) =>
					Effect.gen(function* () {
						const { entityId } = entry.subject;
						const rows = stored.filter((row) => row.subjectEntityId === entityId);
						const own = rows.find((row) => row.kind === "subject");
						if (own?.status !== "pending") {
							return [];
						}
						const absorbedRows = rows.filter((row) => row.kind === "absorbed");
						const absorbed = yield* Effect.forEach(absorbedRows, (row) =>
							Schema.decodeUnknownEffect(FoldAbsorbed)(row.value).pipe(
								Effect.mapError(() => failure("Absorbed fold value is invalid")),
							),
						);
						const changes = yield* Effect.forEach(
							rows.filter((row) => row.kind === "change"),
							(row) =>
								Schema.decodeUnknownEffect(Schema.NullOr(FoldEventImage))(row.value).pipe(
									Effect.mapBoth({
										onFailure: () => failure("Stored fold change is invalid"),
										onSuccess: (before) => {
											const image = now.get(row.targetId);
											return {
												before,
												version: row.version,
												eventId: row.targetId,
												after:
													image && foldSubjectOf(image, known)?.entityId === entityId
														? foldImage(image)
														: null,
											};
										},
									}),
								),
						);
						const replay = { absorbed, changes: null, value: own.value, subjectEntityId: entityId };
						const replayCost = costOf(replay);
						if (replayCost === null) {
							return yield* failure(`Fold input exceeds ${FOLD_LIMITS.inputBytes} UTF-8 bytes`);
						}
						const state = {
							entry,
							version: own.version,
							revision: own.revision ?? 0,
							absorbed: absorbedRows.map(({ targetId }) => targetId),
							consumed: changes.map(({ eventId, version }) => ({ eventId, version })),
						};
						const list = changes.flatMap(({ after, before }) =>
							stableStringify(before) === stableStringify(after) ? [] : [{ after, before }],
						);
						if (!own.replay && absorbed.length === 0 && list.length <= FOLD_LIMITS.inputChanges) {
							const incremental = { ...replay, changes: list };
							const cost = costOf(incremental);
							if (cost !== null) {
								return [{ ...state, cost, input: incremental }];
							}
						}
						return [{ ...state, input: replay, cost: replayCost }];
					}),
				);
				return pack(prepared.flat()).map((subjects): Run => ({
					userId,
					binding,
					pluginId,
					subjects,
				}));
			});

			/** Builds the runs of the user's subjects that have work, grouped by fold. */
			const runsOf = Effect.fnUntraced(function* (
				userId: UserId,
				entityIds: ReadonlyArray<EntityId>,
			) {
				const resolved = yield* route({
					sources: [],
					subjects: entityIds.map((entityId) => ({ userId, entityId })),
				});
				const runs = yield* Effect.forEach(
					Object.values(Arr.groupBy(resolved, foldRunKey)),
					(entries) => prepare(userId, entries),
				);
				return runs.flat();
			});

			/**
			 * Writes a run's outputs: replayed subjects replace theirs, incremental ones patch them. Each
			 * subject consumes exactly what it read: its absorbed values and each stored change still at the
			 * version it read. A subject becomes ready only while no write marked it since the run read it;
			 * otherwise its script may have read part of that write, so its next fold replays. Returns each
			 * subject's revision after the write.
			 */
			const write = Effect.fnUntraced(function* (
				userId: UserId,
				pluginId: PluginId,
				revision: string,
				subjects: ReadonlyArray<{
					readonly value: JsonValue;
					readonly prepared: Prepared;
					readonly rows: ReadonlyArray<OutputRow>;
				}>,
			) {
				const rows = subjects.flatMap((subject) => subject.rows);
				const entityIdOf = ({ prepared }: (typeof subjects)[number]) =>
					prepared.entry.subject.entityId;
				const replayed = subjects.flatMap((subject) =>
					subject.prepared.input.changes === null ? [entityIdOf(subject)] : [],
				);
				const patched = subjects.flatMap((subject) =>
					subject.prepared.input.changes === null ? [] : [entityIdOf(subject)],
				);
				if (replayed.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`delete from derived_value where user_id = ${userId}
							and subject_entity_id in (${foldValuesSql(replayed)}) and kind in ('event', 'relationship')
							and (kind, target_id) not in (select * from jsonb_to_recordset(${JSON.stringify(
								rows.map((row) => ({ kind: row.kind, targetId: row.targetId })),
							)}::jsonb) as r(kind text, "targetId" text))`),
					);
				}
				if (patched.length > 0) {
					const removed = subjects.flatMap((subject) =>
						(subject.prepared.input.changes ?? []).flatMap((change) =>
							change.before && !change.after
								? [{ targetId: change.before.id, entityId: entityIdOf(subject) }]
								: [],
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
				const absorbed = subjects.flatMap(({ prepared }) => prepared.absorbed);
				if (absorbed.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`delete from derived_value where user_id = ${userId} and kind = 'absorbed'
							and target_id in (${foldValuesSql(absorbed)})`),
					);
				}
				const consumed = subjects.flatMap((subject) =>
					subject.prepared.consumed.map((change) => ({ ...change, entityId: entityIdOf(subject) })),
				);
				if (consumed.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`
							delete from derived_change d
							using jsonb_to_recordset(${JSON.stringify(consumed)}::jsonb)
								as c("entityId" text, "eventId" text, version integer)
							where d.user_id = ${userId} and d.subject_entity_id = c."entityId"
								and d.event_id = c."eventId" and d.version = c.version
						`),
					);
				}
				if (rows.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`
							insert into derived_value as v
								(user_id, kind, target_id, subject_entity_id, plugin_id, plugin_revision_id, value)
							select ${userId}, r.kind, r."targetId", r."subjectEntityId", ${pluginId}, ${revision},
								coalesce(r.value, 'null'::jsonb)
							from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
								as r(kind text, "targetId" text, "subjectEntityId" text, value jsonb)
							order by 2, 3
							on conflict (user_id, kind, target_id) do update set value = excluded.value,
								revision = v.revision + 1, subject_entity_id = excluded.subject_entity_id,
								plugin_revision_id = excluded.plugin_revision_id, updated_at = now()
							where v.value is distinct from excluded.value
								or v.subject_entity_id <> excluded.subject_entity_id
								or v.plugin_revision_id <> excluded.plugin_revision_id
						`),
					);
				}
				const written = yield* session.run((db) =>
					db.execute<{ targetId: string; revision: number }>(
						sql`update derived_value v set value = coalesce(s.value, 'null'::jsonb),
							status = case when v.revision = s.revision then 'ready' else v.status end,
							replay = v.revision <> s.revision,
							revision = v.revision + 1, value_version = v.value_version + 1,
							plugin_revision_id = ${revision}, updated_at = now()
						from jsonb_to_recordset(${JSON.stringify(
							subjects.map((subject) => ({
								value: subject.value,
								entityId: entityIdOf(subject),
								revision: subject.prepared.revision,
							})),
						)}::jsonb) as s("entityId" text, value jsonb, revision integer)
						where v.user_id = ${userId} and v.kind = 'subject' and v.target_id = s."entityId"
						returning v.target_id as "targetId", v.revision`,
						"objects",
					),
				);
				return new Map(written.map((row) => [row.targetId, row.revision]));
			});

			const commandOf = Effect.fnUntraced(function* (
				subject: FoldSubject,
				writeContext: DomainLifecycleCommand["writeContext"],
				lane: ExecutionLane,
			) {
				return {
					writeContext,
					...rootLifecycleCommand({
						lane,
						source: "api",
						...lifecycleActor({ userId: subject.userId }),
						itemIdentity: `fold:${subject.entityId}`,
						occurredAt: DateTime.formatIso(yield* DateTime.now),
						executionId: AutomationExecutionId.make(`fold:${subject.userId}:${subject.entityId}`),
					}),
				} satisfies DomainLifecycleCommand;
			});

			/** Runs the fold once over subjects that fit one run and pairs each with its result. */
			const execute = Effect.fnUntraced(function* (run: Run, lane: ExecutionLane) {
				const result = yield* calls.run({
					lane,
					principal: run.binding.principal,
					executionId: `fold-${yield* random.uuidV4()}`,
					input: { subjects: run.subjects.map(({ input }) => input) },
				});
				if (result.error) {
					return yield* failure(
						`Fold failed with ${result.error.kind} during ${result.error.phase}: ${result.error.message}`,
					);
				}
				const output = yield* Schema.decodeUnknownEffect(FoldOutput)(result.value).pipe(
					Effect.mapError((error) => failure(`Fold output is invalid: ${unknownToMessage(error)}`)),
				);
				if (output.subjects.length !== run.subjects.length) {
					return yield* failure("Fold must return one result per subject");
				}
				return yield* Effect.forEach(run.subjects, (prepared) => {
					const item = output.subjects.find(
						({ subjectEntityId }) => subjectEntityId === prepared.entry.subject.entityId,
					);
					return item
						? Effect.succeed({ item, prepared })
						: failure("Fold must return one result per subject");
				});
			});

			/**
			 * Validates and writes a run's results, returning the changes each subject asked for and each
			 * subject's revision after the write.
			 */
			const persist = Effect.fnUntraced(function* (
				transaction: WriteTransaction,
				run: Run,
				results: Results,
				lane: ExecutionLane,
			) {
				const changed: Array<Changed> = [];
				if (results.length === 0) {
					return { changed, revisions: new Map<string, number>() };
				}
				const found = yield* outputTargets(
					transaction,
					run.userId,
					run.pluginId,
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
					const rows = [
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
					writes.push({ rows, prepared, value: item.value });
					if (changes.length > 0) {
						changed.push({
							subject,
							changes,
							command: yield* commandOf(subject, run.binding.principal, lane),
						});
					}
				}
				return {
					changed,
					revisions: yield* write(
						run.userId,
						run.pluginId,
						run.binding.pluginPin.revisionId,
						writes,
					),
				};
			});

			/** Marks subjects' last folds failed; their next folds replay in full. */
			const failed = Effect.fn("Folds.failed")(function* (
				userId: UserId,
				entityIds: ReadonlyArray<string>,
			) {
				yield* session.run((db) =>
					db.execute(sql`update derived_value set status = 'failed', replay = true,
						revision = revision + 1, updated_at = now()
						where user_id = ${userId} and kind = 'subject' and target_id in (${foldValuesSql(entityIds)})`),
				);
			});

			/**
			 * Writes a run's results in the writer's transaction and applies the changes they ask for. A
			 * subject whose value another fold wrote since the run read it is lost and runs again from the
			 * new state. One that asks for changes again while only this fold's own writes marked it since
			 * this fold wrote it, at the revision `written` expects, is marked failed. Returns the written
			 * subjects' revisions.
			 */
			const commitRun = Effect.fnUntraced(function* (
				transaction: WriteTransaction,
				run: Run,
				results: Results,
				input: { readonly lane: ExecutionLane; readonly written: ReadonlyMap<string, number> },
				apply: ApplyFoldChanges,
			) {
				const ids = run.subjects.map(({ entry }) => entry.subject.entityId).sort();
				yield* lockSubjects(ids);
				const versions = new Map(
					(yield* session.run((db) =>
						db.execute<{ version: number; targetId: string }>(
							sql`select target_id as "targetId", value_version as version from derived_value
							where user_id = ${run.userId} and kind = 'subject' and target_id in (${foldValuesSql(ids)})
							order by target_id for update`,
							"objects",
						),
					)).map((row) => [row.targetId, row.version]),
				);
				const current = results.filter(
					({ prepared }) => versions.get(prepared.entry.subject.entityId) === prepared.version,
				);
				const kept = current.filter(
					({ item, prepared }) =>
						item.changes.length > 0 &&
						input.written.get(prepared.entry.subject.entityId) === prepared.revision,
				);
				const applied = current.filter((result) => !kept.includes(result));
				if (kept.length > 0) {
					yield* failed(run.userId, subjectIds(kept));
				}
				const { changed, revisions } = yield* persist(transaction, run, applied, input.lane);
				yield* applyChanges(transaction, changed, apply);
				return {
					revisions,
					kept: subjectIds(kept),
					lost: subjectIds(
						results.filter(({ prepared }) => {
							const version = versions.get(prepared.entry.subject.entityId);
							return version !== undefined && version !== prepared.version;
						}),
					),
				};
			});

			/**
			 * Folds the user's subjects that have work, with no transaction open while a script runs: each
			 * run reads its subjects' stored state without locks, runs the script, and writes its results in
			 * a short transaction. A subject another fold wrote meanwhile runs again from the new state, and
			 * so does every subject the written changes queued, until none is left. Returns whether it wrote
			 * any subject.
			 */
			const fold = Effect.fn("Folds.fold")(function* (
				input: {
					readonly userId: UserId;
					readonly lane: ExecutionLane;
					readonly entityIds: ReadonlyArray<EntityId>;
				},
				writer: FoldWriter,
			) {
				const written = new Map<string, number>();
				const kept: Array<string> = [];
				let entityIds = input.entityIds;
				while (entityIds.length > 0) {
					const next = new Set<EntityId>();
					for (const run of yield* runsOf(input.userId, entityIds)) {
						const results = yield* execute(run, input.lane);
						const { value, queued } = yield* writer.commit((transaction) =>
							commitRun(
								transaction,
								run,
								results,
								{ written, lane: input.lane },
								writer.apply,
							).pipe(asDbError),
						);
						const own = new Set(
							queued.flatMap(({ userId, entityId }) => (userId === input.userId ? [entityId] : [])),
						);
						for (const entityId of own) {
							const revision = value.revisions.get(entityId) ?? written.get(entityId);
							if (revision !== undefined) {
								written.set(entityId, revision + 1);
							}
							next.add(entityId);
						}
						for (const [entityId, revision] of value.revisions) {
							if (!own.has(EntityId.make(entityId))) {
								written.set(entityId, revision);
							}
						}
						kept.push(...value.kept);
						for (const entityId of value.lost) {
							next.add(EntityId.make(entityId));
						}
					}
					entityIds = [...next].sort();
				}
				if (kept.length > 0) {
					return yield* failure("Fold kept changing its own events");
				}
				return written.size > 0;
			}, asDbError);

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

			return { fold, failed, rebuild, queue: queuePending };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(FoldScriptsLive, DefinitionCatalog.layer)),
	);
}
