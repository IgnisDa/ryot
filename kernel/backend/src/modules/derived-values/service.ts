import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { FOLD_LIMITS, FoldAbsorbed, FoldOutput } from "@ryot-app/contract/modules/events/folds";
import type { EventMutationChange } from "@ryot-app/contract/modules/events/mutations";
import type { PluginProjection } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Option, Ref, Schema, type Scope } from "effect";
import { SecureRandom } from "effect/crypto";

import { lifecycleActor, rootLifecycleCausation } from "#modules/automations/lifecycle/command";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { FoldScripts, FoldScriptsLive } from "#modules/scripts/executions/fold-scripts";
import { DirectScriptDeferred, type SandboxAdmission } from "#modules/scripts/executions/queues";
import type { SandboxExecutionResult } from "#modules/scripts/executions/result";
import {
	executeScriptDirectly,
	type ScriptExecutionInput,
} from "#modules/scripts/executions/service";
import { DirectScriptExecutor } from "#modules/scripts/executions/workflow";
import { DatabaseSession } from "#platform/db/session";

import {
	type FoldDeclaration,
	foldJobKey,
	FoldMarks,
	type FoldSubject,
	foldSubjectOf,
	foldValuesSql,
	PendingFoldMarks,
	type PendingFolds,
	type ResolvedFold,
} from "./marks";

export type FoldMode = "job" | "queue" | "inline";

export type ApplyFoldChanges = (input: {
	readonly userId: UserId;
	readonly command: DomainLifecycleCommand;
	readonly changes: ReadonlyArray<EventMutationChange>;
}) => Effect.Effect<void, unknown>;

type Target = {
	readonly id: string;
	readonly propertiesSchema: PluginProjection["propertiesSchema"];
};

type StoredRow = {
	readonly targetId: string;
	readonly value: JsonValue;
	readonly pluginRevisionId: string;
	readonly status: "ready" | "failed" | "pending";
	readonly kind: "event" | "subject" | "absorbed" | "relationship";
};

class FoldFailed extends Schema.TaggedError<FoldFailed, { readonly brand: unique symbol }>()(
	"FoldFailed",
	{ message: Schema.String },
) {}

export const PreparedFold = Context.Reference<null | {
	readonly key: string;
	readonly result: SandboxExecutionResult;
}>("@ryot-app/kernel-backend/modules/derived-values/service/PreparedFold", {
	defaultValue: () => null,
});

const MAX_RUNS = 2;

const INLINE_CAPACITY_RETRIES = 2;

const REBUILD_PAGE = 500;

const failure = (message: string) => new FoldFailed({ message });

type FoldRun = (
	input: ScriptExecutionInput,
	admission: SandboxAdmission,
) => Effect.Effect<SandboxExecutionResult, unknown>;

/**
 * Runs fold scripts once the runtime installs its sandbox executor. Until then, and wherever nothing installs it,
 * such as migrations, every inline fold defers to a job.
 */
class FoldExecutor extends Context.Service<
	FoldExecutor,
	{
		readonly run: FoldRun;
		readonly install: (run: FoldRun) => Effect.Effect<void, never, Scope.Scope>;
	}
>()("@ryot-app/kernel-backend/modules/derived-values/service/FoldExecutor") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const installed = yield* Ref.make(Option.none<FoldRun>());
			return {
				install: (run: FoldRun) =>
					Effect.acquireRelease(Ref.set(installed, Option.some(run)), () =>
						Ref.set(installed, Option.none()),
					),
				run: (input: ScriptExecutionInput, admission: SandboxAdmission) =>
					Effect.flatMap(Ref.get(installed), (run) =>
						Option.isNone(run)
							? Effect.fail(failure("Fold executor is not installed"))
							: run.value(input, admission),
					),
			};
		}),
	);
}

export const FoldExecutorInstalledLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const direct = yield* DirectScriptExecutor;
		yield* (yield* FoldExecutor).install((input, admission) =>
			executeScriptDirectly(direct, input, admission),
		);
	}),
).pipe(Layer.provide(FoldExecutor.layer));

export class Folds extends Context.Service<Folds>()(
	"@ryot-app/kernel-backend/modules/derived-values/service/Folds",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const definitions = yield* DefinitionCatalog;
			const marks = yield* FoldMarks.make;
			const scripts = yield* FoldScripts;
			const executor = yield* FoldExecutor;
			const random = yield* SecureRandom.SecureRandom;

			const { resolve, declarations, queueResolved } = marks;

			const projections = Effect.fn("Folds.projections")(function* (
				subject: FoldSubject,
				declaration: FoldDeclaration,
			) {
				const catalog = yield* definitions.forUser(subject.userId);
				const rows = yield* session.run((db) =>
					db.execute<{
						id: string;
						entityId: string;
						eventSchemaSlug: string;
						entitySchemaSlug: string;
						sessionEntityId: null | string;
					}>(
						sql`select v.id, v.entity_id as "entityId", v.session_entity_id as "sessionEntityId",
							v.event_schema_slug as "eventSchemaSlug", e.entity_schema_slug as "entitySchemaSlug"
						from event v
						join entity e on e.id = v.entity_id
						where v.user_id = ${subject.userId} and v.event_schema_plugin_id = ${declaration.pluginId}
							and v.event_schema_slug in (${foldValuesSql(declaration.eventSchemaSlugs)})
							and (v.entity_id = ${subject.entityId} or v.session_entity_id = ${subject.entityId})`,
						"objects",
					),
				);
				const events = rows.map(({ entitySchemaSlug, ...row }) =>
					Object.assign(row, {
						propertiesSchema:
							catalog.eventSchemas.find(
								(schema) =>
									schema.isEffective &&
									schema.slug === row.eventSchemaSlug &&
									schema.pluginId === declaration.pluginId &&
									schema.entitySchemaSlug === entitySchemaSlug,
							)?.projection?.propertiesSchema ?? null,
					}),
				);
				const sessions = yield* declarations(subject.userId, [
					...new Set(
						events.flatMap((row) =>
							row.entityId === subject.entityId && row.sessionEntityId !== null
								? [row.sessionEntityId]
								: [],
						),
					),
				]);
				const eventTargets = new Map<string, Target>();
				for (const row of events) {
					const source = {
						...row,
						userId: subject.userId,
						eventSchemaPluginId: declaration.pluginId,
					};
					const owner = foldSubjectOf(
						source,
						new Map([...sessions, [subject.entityId, declaration] as const]),
					);
					if (owner?.entityId === subject.entityId && row.propertiesSchema !== null) {
						eventTargets.set(row.id, { id: row.id, propertiesSchema: row.propertiesSchema });
					}
				}
				const relationshipRows = yield* session.run((db) =>
					db.execute<{ id: string; slug: string }>(
						sql`select r.id, r.relationship_schema_slug as slug
						from relationship r
						where r.user_id = ${subject.userId} and r.source_entity_id = ${subject.entityId}
							and r.relationship_schema_plugin_id = ${declaration.pluginId}`,
						"objects",
					),
				);
				const relationships = relationshipRows.flatMap(({ id, slug }) => {
					const projection = catalog.relationshipSchemas.find(
						(schema) =>
							schema.isEffective &&
							schema.slug === slug &&
							schema.pluginId === declaration.pluginId,
					)?.projection;
					return projection ? [{ id, propertiesSchema: projection.propertiesSchema }] : [];
				});
				return {
					events: eventTargets,
					relationships: new Map(relationships.map((row) => [row.id, row])),
				};
			});

			const validated = Effect.fnUntraced(function* (
				kind: "event" | "relationship",
				targets: ReadonlyMap<string, Target>,
				outputs: ReadonlyArray<{ readonly id: string; readonly properties: unknown }>,
			) {
				const ids = new Set(outputs.map(({ id }) => id));
				if (ids.size !== outputs.length || ids.size !== targets.size) {
					return yield* failure(`Fold must return one value for each projected ${kind}`);
				}
				return yield* Effect.forEach(outputs, (output) =>
					Effect.gen(function* () {
						const target = targets.get(output.id);
						if (!target) {
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
						return { kind, value, targetId: output.id };
					}),
				);
			});

			const inputs = Effect.fnUntraced(function* (
				subject: FoldSubject,
				declaration: FoldDeclaration,
				lock: boolean,
			) {
				const binding = yield* scripts.resolve({
					userId: subject.userId,
					pluginId: declaration.pluginId,
					scriptSlug: declaration.scriptSlug,
				});
				if (!binding) {
					return yield* failure("Fold script is unavailable");
				}
				if (lock) {
					yield* session.run((db) =>
						db.execute(sql`select 1 from entity where id = ${subject.entityId} for no key update`),
					);
				}
				const stored = yield* session.run((db) =>
					db.execute<StoredRow>(
						sql`select kind, target_id as "targetId", value, status, plugin_revision_id as "pluginRevisionId"
						from derived_value where user_id = ${subject.userId} and subject_entity_id = ${subject.entityId}`,
						"objects",
					),
				);
				const absorbed = yield* Effect.forEach(
					stored.filter((row) => row.kind === "absorbed"),
					(row) =>
						Schema.decodeUnknownEffect(FoldAbsorbed)(row.value).pipe(
							Effect.mapError(() => failure("Absorbed fold value is invalid")),
						),
				);
				const value = stored.find((row) => row.kind === "subject")?.value ?? null;
				const input = { value, absorbed, subjectEntityId: subject.entityId };
				const key = stableStringify({
					input,
					pin: binding.pluginPin,
					scriptId: binding.principal.scriptId,
				});
				return { key, input, stored, binding };
			});

			const execute = (
				{ input, binding }: Effect.Success<ReturnType<typeof inputs>>,
				lane: ExecutionLane,
				admission: SandboxAdmission,
			) =>
				Effect.flatMap(random.uuidV4(), (id) =>
					executor.run(
						{
							lane,
							input,
							executionId: `fold-${id}`,
							pluginRevision: binding.pluginPin,
							subject: binding.principal.subject,
							scriptId: binding.principal.scriptId,
						},
						admission,
					),
				);

			/**
			 * Runs a job's fold before its transaction takes locks, so it can wait for a sandbox lease. The locked run
			 * reuses the result only while the fold's inputs are unchanged.
			 */
			const prepare = Effect.fn("Folds.prepare")(
				function* (subject: FoldSubject) {
					const [entry] = yield* resolve({ sources: [], subjects: [subject] });
					if (!entry) {
						return null;
					}
					const read = yield* inputs(entry.subject, entry.declaration, false);
					const result = yield* execute(read, "background", "queued");
					return result.error ? null : { result, key: read.key };
				},
				Effect.orElseSucceed(() => null),
			);

			const run = Effect.fn("Folds.run")(function* (
				subject: FoldSubject,
				declaration: FoldDeclaration,
				lane: ExecutionLane,
			) {
				const read = yield* inputs(subject, declaration, true);
				const { stored, binding } = read;
				const prepared = yield* PreparedFold;
				const result =
					prepared?.key === read.key
						? prepared.result
						: yield* execute(read, lane, "direct").pipe(
								// A locked fold must not wait long for a lease, so it retries only a briefly busy lane.
								Effect.retry({
									while: (error) => error instanceof DirectScriptDeferred,
									times: lane === "interactive" ? INLINE_CAPACITY_RETRIES : 0,
								}),
								Effect.mapError((error) =>
									failure(`Fold could not run in the sandbox: ${String(error)}`),
								),
							);
				if (result.error) {
					return yield* failure(
						`Fold failed with ${result.error.kind} during ${result.error.phase}: ${result.error.message}`,
					);
				}
				const output = yield* Schema.decodeUnknownEffect(FoldOutput)(result.value).pipe(
					Effect.mapError((error) => failure(`Fold output is invalid: ${unknownToMessage(error)}`)),
				);
				if (
					new TextEncoder().encode(stableStringify(output.value)).length > FOLD_LIMITS.valueBytes
				) {
					return yield* failure("Fold value exceeds its size limit");
				}
				const targets = yield* projections(subject, declaration);
				const rows = [
					{ value: output.value, kind: "subject" as const, targetId: subject.entityId as string },
					...(yield* validated(
						"event",
						targets.events,
						output.events.map((item) => ({ id: item.eventId, properties: item.properties })),
					)),
					...(yield* validated(
						"relationship",
						targets.relationships,
						output.relationships.map((item) => ({
							id: item.relationshipId,
							properties: item.properties,
						})),
					)),
				];
				const revision = binding.pluginPin.revisionId;
				const current = new Map(stored.map((row) => [`${row.kind}:${row.targetId}`, row]));
				const changed = rows.filter((row) => {
					const existing = current.get(`${row.kind}:${row.targetId}`);
					return (
						existing?.status !== "ready" ||
						existing.pluginRevisionId !== revision ||
						stableStringify(existing.value) !== stableStringify(row.value)
					);
				});
				const kept = new Set(rows.map((row) => `${row.kind}:${row.targetId}`));
				const removed = stored.filter((row) => !kept.has(`${row.kind}:${row.targetId}`));
				if (removed.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`delete from derived_value where user_id = ${subject.userId}
							and (kind, target_id) in (select * from jsonb_to_recordset(${JSON.stringify(
								removed.map((row) => ({ kind: row.kind, targetId: row.targetId })),
							)}::jsonb) as r(kind text, "targetId" text))`),
					);
				}
				if (changed.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`
							insert into derived_value as v
								(user_id, kind, target_id, subject_entity_id, plugin_id, plugin_revision_id, value, status, updated_at)
							select ${subject.userId}, r.kind, r."targetId", ${subject.entityId}, ${declaration.pluginId}, ${revision}, coalesce(r.value, 'null'::jsonb), 'ready', now()
							from jsonb_to_recordset(${JSON.stringify(changed)}::jsonb) as r(kind text, "targetId" text, value jsonb)
							order by 2, 3
							on conflict (user_id, kind, target_id) do update set value = excluded.value,
								status = 'ready', subject_entity_id = excluded.subject_entity_id,
								plugin_revision_id = excluded.plugin_revision_id, updated_at = now()
						`),
					);
				}
				if (output.changes.length === 0) {
					return null;
				}
				const actor = lifecycleActor({ userId: subject.userId });
				const command: DomainLifecycleCommand = {
					writeContext: binding.principal,
					accountUserId: actor.accountUserId,
					itemIdentity: `fold:${subject.entityId}`,
					occurredAt: DateTime.formatIso(yield* DateTime.now),
					causation: rootLifecycleCausation({
						lane,
						source: "api",
						initiator: actor.initiator,
						executionId: AutomationExecutionId.make(`fold:${subject.userId}:${subject.entityId}`),
					}),
				};
				return { command, changes: output.changes };
			});

			const settleOne = Effect.fnUntraced(function* (
				entry: ResolvedFold,
				apply: ApplyFoldChanges,
				lane: ExecutionLane,
				runs: Map<string, number>,
			) {
				const key = foldJobKey(entry.subject);
				const count = (runs.get(key) ?? 0) + 1;
				runs.set(key, count);
				const result = yield* run(entry.subject, entry.declaration, lane);
				if (result !== null) {
					yield* count >= MAX_RUNS
						? failure("Fold kept changing its own events")
						: apply({ userId: entry.subject.userId, ...result }).pipe(
								Effect.mapError((error) =>
									failure(`Fold changes could not be applied: ${unknownToMessage(error)}`),
								),
							);
				}
			});

			const settle = Effect.fn("Folds.settle")(function* (
				pending: PendingFolds,
				apply: ApplyFoldChanges,
				mode: Exclude<FoldMode, "queue">,
			) {
				const runs = new Map<string, number>();
				for (;;) {
					const resolved = yield* resolve({
						sources: pending.sources.splice(0),
						subjects: pending.subjects.splice(0),
					});
					if (resolved.length === 0) {
						return;
					}
					for (const entry of resolved) {
						if (mode === "job") {
							yield* settleOne(entry, apply, "background", runs).pipe(
								Effect.mapError((error) => new DbError({ message: error.message })),
							);
							continue;
						}
						const marked = { sources: pending.sources.length, subjects: pending.subjects.length };
						const settled = yield* session
							.savepoint(settleOne(entry, apply, "interactive", runs))
							.pipe(
								Effect.catchTag("DatabaseSessionStateError", Effect.die),
								Effect.as(true),
								Effect.catchTag("FoldFailed", (error) =>
									Effect.logWarning("Fold deferred to a job", error.message).pipe(
										Effect.annotateLogs({ subjectEntityId: entry.subject.entityId }),
										Effect.as(false),
									),
								),
							);
						if (!settled) {
							pending.sources.length = marked.sources;
							pending.subjects.length = marked.subjects;
							yield* queueResolved([entry]);
						}
					}
				}
			});

			/**
			 * Runs `work` with fold marks collected, then folds every marked subject before the caller commits.
			 * `queue` defers them all to jobs; `job` lets a fold failure fail the work.
			 */
			const within = <A, E, R>(
				work: Effect.Effect<A, E, R>,
				apply: ApplyFoldChanges,
				mode: FoldMode = "inline",
			) =>
				Effect.gen(function* () {
					const pending: PendingFolds = { sources: [], subjects: [] };
					const result = yield* work.pipe(Effect.provideService(PendingFoldMarks, pending));
					if (mode === "queue") {
						yield* queueResolved(yield* resolve(pending));
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
			}) {
				const rows = yield* session.run((db) =>
					db.execute<{ entityId: string; eventSchemaSlug: string; sessionEntityId: null | string }>(
						sql`with page as (select distinct entity_id from event
							where user_id = ${input.userId} and event_schema_plugin_id = ${input.pluginId}
								and (${input.after}::text is null or entity_id > ${input.after})
							order by entity_id limit ${REBUILD_PAGE})
						select distinct v.entity_id as "entityId", v.session_entity_id as "sessionEntityId",
							v.event_schema_slug as "eventSchemaSlug"
						from event v join page on page.entity_id = v.entity_id
						where v.user_id = ${input.userId} and v.event_schema_plugin_id = ${input.pluginId}
						order by 1`,
						"objects",
					),
				);
				const resolved = yield* resolve({
					subjects: [],
					sources: rows.map((row) => ({
						...row,
						userId: input.userId,
						eventSchemaPluginId: input.pluginId,
					})),
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
				let after: null | string = null;
				do {
					const page = yield* session
						.transaction(
							Effect.gen(function* () {
								const found = yield* subjectsOfPlugin({ ...input, after });
								yield* queueResolved(found.resolved);
								return found.after;
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
					after = page;
				} while (after !== null);
			});

			return { within, failed, rebuild, prepare };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(FoldScriptsLive, FoldExecutor.layer, DefinitionCatalog.layer)),
	);
}
