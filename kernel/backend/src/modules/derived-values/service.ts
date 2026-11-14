import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { FOLD_LIMITS, FoldAbsorbed, FoldOutput } from "@ryot-app/contract/modules/events/folds";
import type { EventMutationChange } from "@ryot-app/contract/modules/events/mutations";
import type { PluginProjection } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { AutomationExecutionId, EntityId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import { isAdmissionQueueFull } from "@ryot-app/sandbox/host/admission";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sql } from "drizzle-orm";
import {
	Context,
	DateTime,
	Duration,
	Effect,
	Layer,
	Option,
	Ref,
	Schedule,
	Schema,
	type Scope,
} from "effect";
import { SecureRandom } from "effect/crypto";

import { lifecycleActor, rootLifecycleCausation } from "#modules/automations/lifecycle/command";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
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

export const FoldReservation = Context.Reference<null | {
	readonly subject: string;
	readonly admission: SandboxAdmission;
}>("@ryot-app/kernel-backend/modules/derived-values/service/FoldReservation", {
	defaultValue: () => null,
});

const MAX_RUNS = 2;

export const isFoldBusy = (error: unknown) =>
	error instanceof DbError && error.code === "RYOT_FOLD_BUSY";

const REBUILD_PAGE = 500;

const failure = (message: string) => new FoldFailed({ message });

type FoldRun = (
	input: ScriptExecutionInput,
	admission: SandboxAdmission,
) => Effect.Effect<SandboxExecutionResult, unknown>;

type FoldExecution = {
	readonly run: FoldRun;
	readonly reserve: (
		principal: ScriptExecutionPrincipal,
	) => Effect.Effect<SandboxAdmission, unknown, Scope.Scope>;
};

class FoldExecutor extends Context.Service<
	FoldExecutor,
	FoldExecution & {
		readonly install: (executor: FoldExecution) => Effect.Effect<void, never, Scope.Scope>;
	}
>()("@ryot-app/kernel-backend/modules/derived-values/service/FoldExecutor") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const installed = yield* Ref.make(Option.none<FoldExecution>());
			const current = Ref.get(installed).pipe(
				Effect.flatMap(Effect.fromOption),
				Effect.mapError(() => failure("Fold executor is not installed")),
			);
			return {
				reserve: (principal: ScriptExecutionPrincipal) =>
					Effect.flatMap(current, (executor) => executor.reserve(principal)),
				run: (input: ScriptExecutionInput, admission: SandboxAdmission) =>
					Effect.flatMap(current, (executor) => executor.run(input, admission)),
				install: (executor) =>
					Effect.acquireRelease(Ref.set(installed, Option.some(executor)), () =>
						Ref.set(installed, Option.none()),
					),
			};
		}),
	);
}

export const FoldExecutorInstalledLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const direct = yield* DirectScriptExecutor;
		const sandbox = yield* SandboxExecutor;
		yield* (yield* FoldExecutor).install({
			run: (input, admission) => executeScriptDirectly(direct, input, admission),
			reserve: (principal) =>
				sandbox.reserve(principal, "background").pipe(
					Effect.retry({
						while: isAdmissionQueueFull,
						schedule: Schedule.spaced(Duration.millis(100)),
					}),
					Effect.map((lease) => ({ lease, lane: "background" as const })),
				),
		});
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
			) {
				const binding = yield* scripts.resolve({
					userId: subject.userId,
					pluginId: declaration.pluginId,
					scriptSlug: declaration.scriptSlug,
				});
				if (!binding) {
					return yield* failure("Fold script is unavailable");
				}
				const reservation = yield* FoldReservation;
				// A reserved job must not wait on a writer that needs sandbox capacity to finish.
				const lock = reservation?.subject === foldJobKey(subject) ? sql`nowait` : sql``;
				yield* session.run((db) =>
					db.execute(
						sql`select 1 from entity where id = ${subject.entityId} for no key update ${lock}`,
					),
				);
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
				return { input, stored, binding };
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

			const reserve = Effect.fn("Folds.reserve")(function* (subject: FoldSubject) {
				yield* session.requireRoot;
				const [entry] = yield* resolve({ sources: [], subjects: [subject] });
				if (!entry) {
					return null;
				}
				const binding = yield* scripts.resolve({
					userId: subject.userId,
					pluginId: entry.declaration.pluginId,
					scriptSlug: entry.declaration.scriptSlug,
				});
				if (!binding) {
					return yield* failure("Fold script is unavailable");
				}
				return {
					subject: foldJobKey(subject),
					admission: yield* executor.reserve(binding.principal),
				};
			});

			const run = Effect.fn("Folds.run")(function* (
				subject: FoldSubject,
				declaration: FoldDeclaration,
				lane: ExecutionLane,
			) {
				const read = yield* inputs(subject, declaration);
				const { stored, binding } = read;
				const reservation = yield* FoldReservation;
				const result = yield* execute(
					read,
					lane,
					reservation?.subject === foldJobKey(subject) ? reservation.admission : "direct",
				).pipe(
					Effect.mapError((error) =>
						error instanceof DirectScriptDeferred
							? new DbError({
									code: "RYOT_FOLD_BUSY",
									message: "Script capacity is busy; retry the save",
								})
							: failure(`Fold could not run in the sandbox: ${String(error)}`),
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
						yield* settleOne(
							entry,
							apply,
							mode === "job" ? "background" : "interactive",
							runs,
						).pipe(
							Effect.mapError((error) =>
								error instanceof DbError ? error : new DbError({ message: error.message }),
							),
						);
					}
				}
			});

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
				const resolved = yield* resolve({
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

			return { within, failed, rebuild, reserve };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(FoldScriptsLive, FoldExecutor.layer, DefinitionCatalog.layer)),
	);
}
