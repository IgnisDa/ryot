import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import type { PluginEntityFold } from "@ryot-app/contract/modules/plugins/manifest";
import { EntityId, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Context, Duration, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { JobQueue, makeJobKind } from "#platform/jobs/queue";

export type FoldSubject = { readonly userId: UserId; readonly entityId: EntityId };

export type ResolvedFold = { readonly subject: FoldSubject; readonly declaration: FoldDeclaration };

export type PendingFolds = {
	readonly sources: Array<FoldSource>;
	readonly subjects: Array<FoldSubject>;
};

export type FoldDeclaration = PluginEntityFold & {
	readonly entityId: EntityId;
	readonly pluginId: PluginId;
	readonly entitySchemaSlug: string;
	readonly pluginRevisionId: string;
};

export type FoldSource = {
	readonly userId: string;
	readonly entityId: string;
	readonly eventSchemaSlug: string;
	readonly eventSchemaPluginId: null | string;
	readonly sessionEntityId?: null | string | undefined;
};

const FoldSubjectPayload = Schema.Struct({ userId: UserId, entityId: EntityId });

// A fold that finds its sandbox lane busy fails its attempt, so attempts must outlast passing contention
// before a subject is marked failed.
export const FoldJob = makeJobKind("fold", {
	concurrency: 4,
	maxAttempts: 8,
	payload: FoldSubjectPayload,
	backoff: Duration.seconds(1),
});

export const FoldRebuildJob = makeJobKind("fold-rebuild", {
	maxAttempts: 3,
	payload: Schema.Struct({ userId: UserId, pluginId: PluginId }),
});

export const foldJobKey = (subject: FoldSubject) => `${subject.userId}:${subject.entityId}`;

export const PendingFoldMarks = Context.Reference<null | PendingFolds>("FoldMarks.Pending", {
	defaultValue: () => null,
});

export const foldValuesSql = (values: ReadonlyArray<string>) =>
	sql`select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)`;

const valuesSql = foldValuesSql;

const folds = (declaration: undefined | FoldDeclaration, source: FoldSource) =>
	declaration !== undefined &&
	declaration.pluginId === source.eventSchemaPluginId &&
	declaration.eventSchemaSlugs.includes(source.eventSchemaSlug);

/** An event belongs to its session when the session's schema folds it, and otherwise to its entity. */
export const foldSubjectOf = (source: FoldSource, known: ReadonlyMap<string, FoldDeclaration>) => {
	const session = source.sessionEntityId ? known.get(source.sessionEntityId) : undefined;
	if (folds(session, source)) {
		return session;
	}
	const own = known.get(source.entityId);
	return folds(own, source) ? own : undefined;
};

/** Collects the subjects a transaction's writes change, or queues their folds when nothing collects them. */
export class FoldMarks extends Context.Service<FoldMarks>()(
	"@ryot-app/kernel-backend/modules/derived-values/marks/FoldMarks",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const jobs = yield* JobQueue.make;
			const requireTransaction = session.requireTransaction.pipe(
				Effect.mapError(() => new DbError({ message: "Folds require an active transaction" })),
			);
			const declarations = Effect.fn("FoldMarks.declarations")(function* (
				userId: UserId,
				entityIds: ReadonlyArray<string>,
			) {
				const ids = [...new Set(entityIds)].sort();
				if (ids.length === 0) {
					return new Map<string, FoldDeclaration>();
				}
				const rows = yield* session.run((db) =>
					db.execute<{
						entityId: string;
						pluginId: string;
						fold: PluginEntityFold;
						entitySchemaSlug: string;
						pluginRevisionId: string;
					}>(
						sql`select e.id as "entityId", d.plugin_id as "pluginId", d.fold,
							d.slug as "entitySchemaSlug", d.plugin_revision_id as "pluginRevisionId"
						from entity e
						join user_entity_schema d on d.user_id = ${userId} and d.slug = e.entity_schema_slug
							and d.plugin_id is not distinct from e.entity_schema_plugin_id and d.is_effective
						where e.id in (${valuesSql(ids)}) and d.fold is not null and d.plugin_id is not null`,
						"objects",
					),
				);
				return new Map(
					rows.map((row) => [
						row.entityId,
						{
							...row.fold,
							entityId: EntityId.make(row.entityId),
							pluginId: PluginId.make(row.pluginId),
							entitySchemaSlug: row.entitySchemaSlug,
							pluginRevisionId: row.pluginRevisionId,
						},
					]),
				);
			});

			const resolve = Effect.fn("FoldMarks.resolve")(function* (pending: PendingFolds) {
				const subjects = new Map<string, ResolvedFold>();
				const users = new Set([
					...pending.sources.map((source) => source.userId),
					...pending.subjects.map((subject) => subject.userId),
				]);
				for (const user of [...users].sort()) {
					const userId = UserId.make(user);
					const sources = pending.sources.filter((source) => source.userId === user);
					const explicit = pending.subjects.filter((subject) => subject.userId === user);
					const known = yield* declarations(userId, [
						...sources.flatMap((source) =>
							source.sessionEntityId
								? [source.entityId, source.sessionEntityId]
								: [source.entityId],
						),
						...explicit.map((subject) => subject.entityId),
					]);
					const add = (declaration: undefined | FoldDeclaration) => {
						if (declaration) {
							const subject = { userId, entityId: declaration.entityId };
							subjects.set(foldJobKey(subject), { subject, declaration });
						}
					};
					for (const source of sources) {
						add(foldSubjectOf(source, known));
					}
					for (const subject of explicit) {
						add(known.get(subject.entityId));
					}
				}
				return [...subjects.entries()]
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([, value]) => value);
			});

			const queueResolved = Effect.fn("FoldMarks.queueResolved")(function* (
				resolved: ReadonlyArray<ResolvedFold>,
			) {
				if (resolved.length === 0) {
					return 0;
				}
				yield* session.run((db) =>
					db.execute(sql`
						insert into derived_value as v
							(user_id, kind, target_id, subject_entity_id, plugin_id, plugin_revision_id, value, status)
						select s."userId", 'subject', s."entityId", s."entityId", s."pluginId", s."pluginRevisionId", 'null'::jsonb, 'pending'
						from jsonb_to_recordset(${JSON.stringify(
							resolved.map(({ subject, declaration }) => ({
								userId: subject.userId,
								entityId: subject.entityId,
								pluginId: declaration.pluginId,
								pluginRevisionId: declaration.pluginRevisionId,
							})),
						)}::jsonb) as s("userId" text, "entityId" text, "pluginId" text, "pluginRevisionId" text)
						order by 1, 3
						on conflict (user_id, kind, target_id) do update set status = 'pending'
					`),
				);
				let queued = 0;
				for (const { subject } of resolved) {
					const inserted = yield* jobs
						.enqueue(FoldJob, subject, { userId: subject.userId, key: foldJobKey(subject) })
						.pipe(Effect.mapError((error) => new DbError({ message: unknownToMessage(error) })));
					queued += inserted ? 1 : 0;
				}
				return queued;
			});

			/** Queues a fold job for each subject, for changes that need not settle in their own write. */
			const queue = Effect.fn("FoldMarks.queue")(function* (subjects: ReadonlyArray<FoldSubject>) {
				return yield* queueResolved(yield* resolve({ sources: [], subjects: [...subjects] }));
			});

			/** Marks the subjects of changed events; outside a fold scope they are queued instead. */
			const mark = Effect.fn("FoldMarks.mark")(function* (sources: ReadonlyArray<FoldSource>) {
				if (sources.length === 0) {
					return;
				}
				yield* requireTransaction;
				const pending = yield* PendingFoldMarks;
				if (pending) {
					pending.sources.push(...sources);
					return;
				}
				yield* queueResolved(yield* resolve({ subjects: [], sources: [...sources] }));
			});

			const markSubjects = Effect.fn("FoldMarks.markSubjects")(function* (
				subjects: ReadonlyArray<FoldSubject>,
			) {
				if (subjects.length === 0) {
					return;
				}
				const pending = yield* PendingFoldMarks;
				if (pending) {
					pending.subjects.push(...subjects);
					return;
				}
				yield* queue(subjects);
			});

			/** Refolds the subjects whose values an entity's content feeds: its own and those of its events. */
			const entityChanged = Effect.fn("FoldMarks.entityChanged")(function* (entityId: EntityId) {
				const rows = yield* session.run((db) =>
					db.execute<{ userId: string; entityId: string }>(
						sql`select distinct v.user_id as "userId", v.subject_entity_id as "entityId"
						from derived_value v
						where v.kind = 'subject' and v.subject_entity_id = ${entityId}
						union
						select distinct v.user_id, v.subject_entity_id
						from event e join derived_value v on v.user_id = e.user_id and v.kind = 'event' and v.target_id = e.id
						where e.entity_id = ${entityId} or e.session_entity_id = ${entityId}`,
						"objects",
					),
				);
				yield* markSubjects(
					rows.map((row) => ({
						userId: UserId.make(row.userId),
						entityId: EntityId.make(row.entityId),
					})),
				);
			});

			return { mark, resolve, declarations, markSubjects, entityChanged, queueResolved };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
