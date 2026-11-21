import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	FOLD_LIMITS,
	FoldAbsorbed,
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

import {
	emptyPendingFolds,
	type FoldDeclaration,
	foldJobKey,
	FoldMarks,
	type FoldRun,
	foldRunKey,
	type FoldSubject,
	foldSubjectOf,
	foldValuesSql,
	PendingFoldMarks,
	type PendingFolds,
	readFoldEvents,
} from "./marks";

export type FoldMode = "job" | "queue" | "inline";

export type ApplyFoldChanges = (input: {
	readonly userId: UserId;
	readonly command: DomainLifecycleCommand;
	readonly changes: ReadonlyArray<EventMutation>;
}) => Effect.Effect<void, unknown>;

/** A subject's input and its cost within a run's subject list. */
type Prepared = {
	readonly cost: number;
	readonly entry: FoldRun;
	readonly input: FoldSubjectInput;
};

type Target = {
	readonly id: string;
	readonly subjectEntityId: string;
	readonly propertiesSchema: AppSchema<unknown>;
};

type OutputRow = {
	readonly value: JsonValue;
	readonly targetId: string;
	readonly kind: StoredRow["kind"];
	readonly subjectEntityId: string;
};

type StoredRow = {
	readonly value: JsonValue;
	readonly subjectEntityId: string;
	readonly status: "ready" | "failed" | "pending";
	readonly kind: "event" | "subject" | "absorbed" | "relationship";
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

			const { route, collect, declarations, queueResolved } = marks;

			/** Finds the events and links a run's outputs may target, each with the subject it belongs to. */
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
						return { kind, value, subjectEntityId, targetId: output.id };
					}),
				);
			});

			/** Locks a fold's subjects and builds each one's input, incremental when it can be. */
			const prepare = Effect.fnUntraced(function* (
				userId: UserId,
				pluginId: PluginId,
				scriptSlug: string,
				entries: ReadonlyArray<FoldRun>,
			) {
				const binding = yield* scripts.resolve({ userId, pluginId, scriptSlug });
				if (!binding) {
					return yield* failure("Fold script is unavailable");
				}
				const ids = entries.map(({ subject }) => subject.entityId).sort();
				yield* session.run((db) =>
					db.execute(
						sql`select 1 from entity where id in (${foldValuesSql(ids)}) order by id for no key update`,
					),
				);
				const stored = yield* session.run((db) =>
					db.execute<StoredRow>(
						sql`select kind, value, status, subject_entity_id as "subjectEntityId" from derived_value
						where user_id = ${userId} and subject_entity_id in (${foldValuesSql(ids)})
							and kind in ('subject', 'absorbed')`,
						"objects",
					),
				);
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
						if (own?.status === "ready" && absorbed.length === 0 && entry.changes !== null) {
							const incremental = { ...replay, changes: entry.changes };
							const cost = costOf(incremental);
							if (cost !== null) {
								return { cost, entry, input: incremental };
							}
						}
						return { entry, input: replay, cost: replayCost };
					}),
				);
				return { binding, prepared };
			});

			/** Writes a run's outputs: replayed subjects replace theirs, incremental ones patch them. */
			const write = Effect.fnUntraced(function* (
				userId: UserId,
				pluginId: PluginId,
				revision: string,
				subjects: ReadonlyArray<{
					readonly entityId: string;
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
				yield* session.run((db) =>
					db.execute(sql`
						insert into derived_value as v
							(user_id, kind, target_id, subject_entity_id, plugin_id, plugin_revision_id, value, status, updated_at)
						select ${userId}, r.kind, r."targetId", r."subjectEntityId", ${pluginId}, ${revision}, coalesce(r.value, 'null'::jsonb), 'ready', now()
						from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
							as r(kind text, "targetId" text, "subjectEntityId" text, value jsonb)
						order by 2, 3
						on conflict (user_id, kind, target_id) do update set value = excluded.value,
							status = 'ready', subject_entity_id = excluded.subject_entity_id,
							plugin_revision_id = excluded.plugin_revision_id, updated_at = now()
						where v.value is distinct from excluded.value or v.status <> 'ready'
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

			/** Folds one fold's subjects in as few runs as fit, returning the changes each subject asked for. */
			const run = Effect.fn("Folds.run")(function* (
				entries: Arr.NonEmptyReadonlyArray<FoldRun>,
				lane: ExecutionLane,
			) {
				const [
					{
						subject: { userId },
						declaration: { pluginId, scriptSlug },
					},
				] = entries;
				const { binding, prepared } = yield* prepare(userId, pluginId, scriptSlug, entries);
				const changed: Array<{
					readonly subject: FoldSubject;
					readonly command: DomainLifecycleCommand;
					readonly changes: ReadonlyArray<EventMutation>;
				}> = [];
				for (const subjects of pack(prepared)) {
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
						Effect.mapError((error) =>
							failure(`Fold output is invalid: ${unknownToMessage(error)}`),
						),
					);
					if (output.subjects.length !== subjects.length) {
						return yield* failure("Fold must return one result per subject");
					}
					const found = yield* outputTargets(
						userId,
						pluginId,
						subjects.map(({ entry }) => entry.declaration),
						output.subjects,
					);
					const writes = [];
					for (const { entry, input } of subjects) {
						const { subject } = entry;
						const item = output.subjects.find(
							({ subjectEntityId }) => subjectEntityId === subject.entityId,
						);
						if (!item) {
							return yield* failure("Fold must return one result per subject");
						}
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
						writes.push({ rows, changes: input.changes, entityId: subject.entityId });
						if (changes.length > 0) {
							changed.push({
								subject,
								changes,
								command: yield* commandOf(subject, binding.principal, lane),
							});
						}
					}
					yield* write(userId, pluginId, binding.pluginPin.revisionId, writes);
				}
				return changed;
			});

			/** Runs each fold once over every subject collected, applies their changes, and repeats until none remain. */
			const settle = Effect.fn("Folds.settle")(
				function* (
					pending: PendingFolds,
					apply: ApplyFoldChanges,
					mode: Exclude<FoldMode, "queue">,
				) {
					const lane = mode === "job" ? "background" : "interactive";
					const runs = new Map<string, number>();
					for (
						let resolved = yield* collect(pending);
						resolved.length > 0;
						resolved = yield* collect(pending)
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
							changed.push(...(yield* run(entries, lane)));
						}
						yield* changed.some(({ subject }) => (runs.get(foldJobKey(subject)) ?? 0) >= MAX_RUNS)
							? failure("Fold kept changing its own events")
							: Effect.forEach(
									changed,
									({ subject, command, changes }) =>
										apply({ command, changes, userId: subject.userId }).pipe(
											Effect.mapError((error) =>
												failure(`Fold changes could not be applied: ${unknownToMessage(error)}`),
											),
										),
									{ discard: true },
								);
					}
				},
				Effect.mapError((error) =>
					error instanceof DbError ? error : new DbError({ message: error.message }),
				),
			);

			const within = <A, E, R>(
				work: Effect.Effect<A, E, R>,
				apply: ApplyFoldChanges,
				mode: FoldMode = "inline",
			) =>
				Effect.gen(function* () {
					const pending = emptyPendingFolds();
					const result = yield* work.pipe(Effect.provideService(PendingFoldMarks, pending));
					if (mode === "queue") {
						yield* queueResolved(
							yield* route({
								subjects: [...pending.replays, ...pending.links],
								sources: [...pending.events.values()].flatMap((mark) =>
									[mark.before, mark.after].flatMap((source) => (source ? [source] : [])),
								),
							}),
						);
					} else {
						yield* settle(pending, apply, mode).pipe(
							Effect.provideService(PendingFoldMarks, pending),
						);
					}
					return result;
				});

			const failed = Effect.fn("Folds.failed")(function* (subject: FoldSubject) {
				yield* session.run((db) =>
					db.execute(sql`update derived_value set status = 'failed', updated_at = now()
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

			return { within, failed, rebuild };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(FoldScriptsLive, DefinitionCatalog.layer)),
	);
}
