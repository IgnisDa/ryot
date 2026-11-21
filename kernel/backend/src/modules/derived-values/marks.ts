import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	FOLD_LIMITS,
	type FoldEventChange,
	type FoldEventImage,
} from "@ryot-app/contract/modules/events/folds";
import type { PluginEntityFold } from "@ryot-app/contract/modules/plugins/manifest";
import { EntityId, EventId, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { type SQL, sql } from "drizzle-orm";
import { Array as Arr, Context, Duration, Effect, Layer, Schema } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue, makeJobKind } from "#platform/jobs/queue";

/** An event as it was before the transaction first changed it, with the fields that route it to a subject. */
export type FoldEventRow = FoldSource & FoldEventImage;

export type FoldSubject = { readonly userId: UserId; readonly entityId: EntityId };

/** A subject to fold: `changes` is null for a full replay and otherwise lists its changed events. */
export type FoldRun = ResolvedFold & { readonly changes: null | ReadonlyArray<FoldEventChange> };

export type ResolvedFold = { readonly subject: FoldSubject; readonly declaration: FoldDeclaration };

export type PendingFolds = {
	readonly links: Array<FoldSubject>;
	readonly replays: Array<FoldSubject>;
	readonly events: Map<string, FoldMark>;
};

/** One changed event: its image before the change, null for a create, and where it is now, null once deleted. */
type FoldMark = {
	readonly userId: string;
	readonly eventId: string;
	readonly after: null | FoldSource;
	readonly before: null | FoldEventRow;
};

export const emptyPendingFolds = (): PendingFolds => ({
	links: [],
	replays: [],
	events: new Map(),
});

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

export const FoldJob = makeJobKind("fold", {
	concurrency: 4,
	maxAttempts: 8,
	backoff: Duration.seconds(1),
	payload: Schema.Struct({
		userId: UserId,
		entityIds: Schema.Array(EntityId).check(
			Schema.isMinLength(1),
			Schema.isMaxLength(FOLD_LIMITS.runSubjects),
		),
	}),
});

export const FoldRebuildJob = makeJobKind("fold-rebuild", {
	maxAttempts: 3,
	payload: Schema.Struct({ userId: UserId, pluginId: PluginId }),
});

export const foldJobKey = (subject: FoldSubject) => `${subject.userId}:${subject.entityId}`;

/** Subjects of one fold for one user share a run. */
export const foldRunKey = ({ subject, declaration }: ResolvedFold) =>
	`${subject.userId}:${declaration.pluginId}:${declaration.scriptSlug}`;

export const PendingFoldMarks = Context.Reference<null | PendingFolds>("FoldMarks.Pending", {
	defaultValue: () => null,
});

export const foldValuesSql = (values: ReadonlyArray<string>) =>
	sql`select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)`;

const isoSql = (column: string) =>
	sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** Reads fold images of the events `where` selects, with `v` the event and `e` its entity. */
export const readFoldEvents = (session: DatabaseSession["Service"], where: SQL) =>
	session
		.run((db) =>
			db.execute<{
				id: string;
				userId: string;
				revision: number;
				entityId: string;
				orderKey: string;
				occurredAt: string;
				orderCreatedAt: string;
				eventSchemaSlug: string;
				entitySchemaSlug: string;
				sessionEntityId: null | string;
				eventSchemaPluginId: null | string;
				properties: Record<string, JsonValue>;
			}>(
				sql`select v.id, v.user_id as "userId", v.revision, v.entity_id as "entityId",
					coalesce(v.order_key, v.id) as "orderKey", ${isoSql("v.occurred_at")} as "occurredAt",
					${isoSql("coalesce(v.order_created_at, v.created_at)")} as "orderCreatedAt",
					v.event_schema_slug as "eventSchemaSlug", e.entity_schema_slug as "entitySchemaSlug",
					v.session_entity_id as "sessionEntityId", v.event_schema_plugin_id as "eventSchemaPluginId",
					v.properties
				from event v join entity e on e.id = v.entity_id
				where ${where}
				order by v.id`,
				"objects",
			),
		)
		.pipe(
			Effect.map((rows) =>
				rows.map((row): FoldEventRow => ({
					...row,
					id: EventId.make(row.id),
					entityId: EntityId.make(row.entityId),
					sessionEntityId: row.sessionEntityId === null ? null : EntityId.make(row.sessionEntityId),
				})),
			),
		);

const foldImage = ({
	userId: _userId,
	eventSchemaPluginId: _pluginId,
	...image
}: FoldEventRow): FoldEventImage => image;

const folds = (declaration: undefined | FoldDeclaration, source: FoldSource) =>
	declaration !== undefined &&
	declaration.pluginId === source.eventSchemaPluginId &&
	declaration.eventSchemaSlugs.includes(source.eventSchemaSlug);

const sourceEntities = (source: FoldSource) =>
	source.sessionEntityId ? [source.entityId, source.sessionEntityId] : [source.entityId];

/** What decides a revision's fold outputs: each fold's script hash and folded event schemas, and projected links. */
const foldSignatureSql = (revisionId: string) => {
	const revision = sql.raw(revisionId);
	return sql`(select jsonb_build_array(
		coalesce((select jsonb_agg(jsonb_build_array(es.slug, es.fold, s.content_hash,
			coalesce((select jsonb_agg(jsonb_build_array(ev.slug, ev.properties_schema, ev.projection) order by ev.slug)
				from definition_event_schema ev where ev.entity_schema_id = es.id
					and ev.slug in (select jsonb_array_elements_text(es.fold -> 'eventSchemaSlugs'))), '[]'::jsonb))
			order by es.slug)
			from definition_entity_schema es
			left join sandbox_script s on s.plugin_revision_id = es.plugin_revision_id and s.slug = es.fold ->> 'scriptSlug'
			where es.plugin_revision_id = ${revision} and es.fold is not null), '[]'::jsonb),
		coalesce((select jsonb_agg(jsonb_build_array(r.slug, r.properties_schema, r.projection) order by r.slug)
			from definition_relationship_schema r
			where r.plugin_revision_id = ${revision} and r.projection is not null), '[]'::jsonb)))`;
};

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
			const catalog = yield* DefinitionCatalog;
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
				const entities = yield* session.run((db) =>
					db.execute<{ id: string; entitySchemaSlug: string; entitySchemaPluginId: string }>(
						sql`select e.id, e.entity_schema_slug as "entitySchemaSlug",
							e.entity_schema_plugin_id as "entitySchemaPluginId"
						from entity e
						where e.id in (${foldValuesSql(ids)}) and e.entity_schema_plugin_id is not null`,
						"objects",
					),
				);
				const schemas = entities.length > 0 ? (yield* catalog.forUser(userId)).entitySchemas : [];
				return new Map(
					entities.flatMap((entity) => {
						const schema = schemas.find(
							(row) =>
								row.isEffective &&
								row.slug === entity.entitySchemaSlug &&
								row.pluginId === entity.entitySchemaPluginId,
						);
						return schema?.fold && schema.pluginRevisionId !== null
							? [
									[
										entity.id,
										{
											...schema.fold,
											entitySchemaSlug: schema.slug,
											entityId: EntityId.make(entity.id),
											pluginRevisionId: schema.pluginRevisionId,
											pluginId: PluginId.make(entity.entitySchemaPluginId),
										},
									] as const,
								]
							: [];
					}),
				);
			});

			const route = Effect.fn("FoldMarks.route")(function* (input: {
				readonly sources: ReadonlyArray<FoldSource>;
				readonly subjects: ReadonlyArray<FoldSubject>;
			}) {
				const subjects = new Map<string, ResolvedFold>();
				const users = new Set([
					...input.sources.map((source) => source.userId),
					...input.subjects.map((subject) => subject.userId),
				]);
				for (const user of [...users].sort()) {
					const userId = UserId.make(user);
					const sources = input.sources.filter((source) => source.userId === user);
					const explicit = input.subjects.filter((subject) => subject.userId === user);
					const known = yield* declarations(userId, [
						...sources.flatMap(sourceEntities),
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

			/** Drains `pending` into one run per subject, pairing each changed event's images by subject. */
			const collect = Effect.fn("FoldMarks.collect")(function* (pending: PendingFolds) {
				const marks = [...pending.events.values()];
				pending.events.clear();
				const replays = pending.replays.splice(0);
				const links = pending.links.splice(0);
				const runs = new Map<
					string,
					{
						subject: FoldSubject;
						declaration: FoldDeclaration;
						changes: null | Array<FoldEventChange>;
					}
				>();
				const users = new Set([
					...marks.map((mark) => mark.userId),
					...replays.map((subject) => subject.userId),
					...links.map((subject) => subject.userId),
				]);
				for (const user of [...users].sort()) {
					const userId = UserId.make(user);
					const changed = marks.filter((mark) => mark.userId === user);
					const current =
						changed.length === 0
							? []
							: yield* readFoldEvents(
									session,
									sql`v.user_id = ${user} and v.id in (${foldValuesSql(changed.map((mark) => mark.eventId))})`,
								);
					const now = new Map<string, FoldEventRow>(current.map((row) => [row.id, row]));
					const replayed = replays.filter((subject) => subject.userId === user);
					const linked = links.filter((subject) => subject.userId === user);
					const known = yield* declarations(userId, [
						...changed.flatMap((mark) => (mark.before ? sourceEntities(mark.before) : [])),
						...current.flatMap(sourceEntities),
						...replayed.map((subject) => subject.entityId),
						...linked.map((subject) => subject.entityId),
					]);
					const run = (declaration: FoldDeclaration) => {
						const subject = { userId, entityId: declaration.entityId };
						const key = foldJobKey(subject);
						const existing = runs.get(key);
						if (existing) {
							return existing;
						}
						const created: {
							subject: FoldSubject;
							declaration: FoldDeclaration;
							changes: null | Array<FoldEventChange>;
						} = { subject, declaration, changes: [] };
						runs.set(key, created);
						return created;
					};
					for (const mark of changed) {
						const after = now.get(mark.eventId) ?? null;
						const from = mark.before ? foldSubjectOf(mark.before, known) : undefined;
						const to = after ? foldSubjectOf(after, known) : undefined;
						if (from && to && from.entityId === to.entityId && mark.before && after) {
							const before = foldImage(mark.before);
							const image = foldImage(after);
							if (stableStringify(before) !== stableStringify(image)) {
								run(from).changes?.push({ before, after: image });
							}
							continue;
						}
						if (from && mark.before) {
							run(from).changes?.push({ after: null, before: foldImage(mark.before) });
						}
						if (to && after) {
							run(to).changes?.push({ before: null, after: foldImage(after) });
						}
					}
					for (const subject of replayed) {
						const declaration = known.get(subject.entityId);
						if (declaration) {
							run(declaration).changes = null;
						}
					}
					for (const subject of linked) {
						const declaration = known.get(subject.entityId);
						if (declaration) {
							run(declaration);
						}
					}
				}
				return [...runs.entries()]
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([, value]): FoldRun =>
						value.changes !== null && value.changes.length > FOLD_LIMITS.inputChanges
							? Object.assign(value, { changes: null })
							: value,
					);
			});

			/** Marks subjects pending and queues fold jobs of up to `size` subjects of one fold. */
			const queueResolved = Effect.fn("FoldMarks.queueResolved")(function* (
				resolved: ReadonlyArray<ResolvedFold>,
				size: number = FOLD_LIMITS.runSubjects,
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
				const byFold = new Map<string, { userId: UserId; entityIds: Array<EntityId> }>();
				for (const entry of resolved) {
					const key = foldRunKey(entry);
					const fold = byFold.get(key) ?? { entityIds: [], userId: entry.subject.userId };
					fold.entityIds.push(entry.subject.entityId);
					byFold.set(key, fold);
				}
				let queued = 0;
				for (const payload of [...byFold.values()].flatMap(({ userId, entityIds }) =>
					Arr.chunksOf(entityIds, size).map((chunk) => ({ userId, entityIds: chunk })),
				)) {
					const inserted = yield* jobs
						.enqueue(FoldJob, payload, {
							userId: payload.userId,
							key: `${payload.userId}:${payload.entityIds.join(",")}`,
						})
						.pipe(Effect.mapError((error) => new DbError({ message: unknownToMessage(error) })));
					queued += inserted ? payload.entityIds.length : 0;
				}
				return queued;
			});

			const queue = Effect.fn("FoldMarks.queue")(function* (subjects: ReadonlyArray<FoldSubject>) {
				return yield* queueResolved(yield* route({ subjects, sources: [] }));
			});

			/** Queues the plugin's folds of the entities for one user, or for every user with their events. */
			const request = Effect.fn("FoldMarks.request")(function* (input: {
				readonly pluginId: PluginId;
				readonly userId: null | UserId;
				readonly entityIds: ReadonlyArray<EntityId>;
			}) {
				yield* requireTransaction;
				const users =
					input.userId === null
						? (yield* session.run((db) =>
								db.execute<{ userId: string }>(
									sql`select distinct user_id as "userId" from event
									where entity_id in (${foldValuesSql(input.entityIds)})
										or session_entity_id in (${foldValuesSql(input.entityIds)})`,
									"objects",
								),
							)).map((row) => UserId.make(row.userId))
						: [input.userId];
				const resolved = yield* route({
					sources: [],
					subjects: users.flatMap((userId) =>
						input.entityIds.map((entityId) => ({ userId, entityId })),
					),
				});
				return yield* queueResolved(
					resolved.filter(({ declaration }) => declaration.pluginId === input.pluginId),
				);
			});

			/** Records changed events for the fold scope; outside one their subjects are queued instead. */
			const mark = Effect.fn("FoldMarks.mark")(function* (marks: ReadonlyArray<FoldMark>) {
				if (marks.length === 0) {
					return;
				}
				yield* requireTransaction;
				const pending = yield* PendingFoldMarks;
				if (pending) {
					for (const value of marks) {
						if (!pending.events.has(value.eventId)) {
							pending.events.set(value.eventId, value);
						}
					}
					return;
				}
				yield* queueResolved(
					yield* route({
						subjects: [],
						sources: marks.flatMap((value) =>
							[value.before, value.after].flatMap((source) => (source ? [source] : [])),
						),
					}),
				);
			});

			const pend = (target: "links" | "replays") =>
				Effect.fnUntraced(function* (subjects: ReadonlyArray<FoldSubject>) {
					if (subjects.length === 0) {
						return;
					}
					const pending = yield* PendingFoldMarks;
					if (pending) {
						pending[target].push(...subjects);
						return;
					}
					yield* queue(subjects);
				});

			/** Marks subjects for a full replay. */
			const markSubjects = pend("replays");

			/** Marks the source subjects of changed relationships, which refold without event changes. */
			const markLinks = pend("links");

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

			/** Hands each source subject's value to its destination's next fold, which marks the destination. */
			const absorb = Effect.fn("FoldMarks.absorb")(function* (input: {
				readonly userId: UserId;
				readonly ids: ReadonlyMap<string, string>;
				readonly references: ReadonlyArray<{ readonly from: EntityId; readonly into: EntityId }>;
			}) {
				yield* requireTransaction;
				const ids = Object.fromEntries(input.ids);
				for (const { from, into } of input.references) {
					yield* session.run((db) =>
						db.execute(sql`
							insert into derived_value (user_id, kind, target_id, subject_entity_id, plugin_id, plugin_revision_id, value)
							select user_id, 'absorbed', target_id, ${into}, plugin_id, plugin_revision_id,
								jsonb_build_object('value', value, 'ids', ${JSON.stringify(ids)}::jsonb)
							from derived_value
							where user_id = ${input.userId} and kind = 'subject' and subject_entity_id = ${from}
							on conflict (user_id, kind, target_id) do update set value = excluded.value,
								subject_entity_id = excluded.subject_entity_id
						`),
					);
				}
				yield* markSubjects(
					input.references.map(({ into }) => ({ entityId: into, userId: input.userId })),
				);
			});

			const queueUserRebuilds = Effect.fn("FoldMarks.queueUserRebuilds")(function* (
				userId: UserId,
			) {
				yield* requireTransaction;
				const definitions = yield* catalog.forUser(userId);
				const pluginIds = new Set(
					definitions.entitySchemas.flatMap((schema) =>
						schema.isEffective && schema.fold && schema.pluginId !== null ? [schema.pluginId] : [],
					),
				);
				for (const id of [...pluginIds].sort()) {
					const pluginId = PluginId.make(id);
					yield* jobs.enqueue(
						FoldRebuildJob,
						{ userId, pluginId },
						{ userId, key: `${userId}:${pluginId}` },
					);
				}
			});

			/**
			 * After a revision install, replays the plugin's folds for the user only when the active revision's
			 * fold signature differs from that of a revision the user's values were folded under; otherwise the
			 * values move to the active revision as they are.
			 */
			const queueRevisionReplay = Effect.fn("FoldMarks.queueRevisionReplay")(function* (input: {
				readonly userId: UserId;
				readonly pluginId: PluginId;
			}) {
				yield* requireTransaction;
				const [row] = yield* session.run((db) =>
					db.execute<{ replay: boolean; revisionId: null | string }>(
						sql`with active as (select active_revision_id as id from plugin where id = ${input.pluginId}),
						folded as (select distinct plugin_revision_id as id from derived_value
							where user_id = ${input.userId} and plugin_id = ${input.pluginId} and kind = 'subject')
						select (select id from active) as "revisionId",
							not exists (select 1 from folded) or exists (select 1 from folded, active
								where ${foldSignatureSql("folded.id")} is distinct from ${foldSignatureSql("active.id")}) as replay`,
						"objects",
					),
				);
				if (!row?.revisionId) {
					return;
				}
				if (row.replay) {
					yield* jobs.enqueue(FoldRebuildJob, input, {
						userId: input.userId,
						key: `${input.userId}:${input.pluginId}`,
					});
					return;
				}
				yield* session.run((db) =>
					db.execute(sql`update derived_value set plugin_revision_id = ${row.revisionId}
						where user_id = ${input.userId} and plugin_id = ${input.pluginId}
							and plugin_revision_id <> ${row.revisionId}`),
				);
			});

			return {
				mark,
				route,
				absorb,
				collect,
				request,
				markLinks,
				declarations,
				markSubjects,
				entityChanged,
				queueResolved,
				queueUserRebuilds,
				queueRevisionReplay,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
	);
}
