import { DbError } from "@ryot-app/contract/errors";
import type { PluginEventProjection } from "@ryot-app/contract/modules/plugins/manifest";
import {
	EntityId,
	type EventId,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import {
	projectionDependencyTargets,
	projectionSourceReferences,
	projectionSources,
} from "./projection-dependencies";

export const StreamKeySchema = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	eventSchemaSlug: EventSchemaSlug,
	eventSchemaPluginId: Schema.NullOr(PluginId),
});

export type StreamKey = typeof StreamKeySchema.Type;

export type EventStreamScope = {
	readonly userId: string;
	readonly eventSchemaSlug: string;
	readonly eventSchemaPluginId: string;
};

export type StreamSource = StreamKey & {
	readonly sessionEntityId?: null | string | undefined;
	readonly properties?: undefined | Readonly<Record<string, unknown>>;
};

export type EventStreamBindingKey = {
	readonly userId: string;
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly eventSchemaPluginId: string;
};

export type EventStreamBinding = {
	readonly accountToken: string;
	readonly pluginRevisionId: string;
	readonly processorScriptId: string;
	readonly configRevisionId: null | string;
};

export type EventStreamBindingDeclaration = EventStreamBindingKey & {
	readonly revision: number;
	readonly accountToken: string;
	readonly pluginRevisionId: string;
	readonly configRevisionId: null | string;
};

type StreamTouch = StreamSource & { readonly occurredAt: Date };

const streamIds = (ids: ReadonlyArray<string>) =>
	sql`(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;

const failedJob = (jobId: SQL) =>
	sql`exists (select 1 from background_work job where job.id = ${jobId} and job.status = 'failed')`;

const failedInBatch = sql`${failedJob(sql`w.current_job_id`)} and not w.claimed_alone`;

const dirtyInScope = (
	scope: EventStreamScope,
	binding: EventStreamBinding,
) => sql`w.user_id = ${scope.userId}
	and w.event_schema_plugin_id = ${scope.eventSchemaPluginId}
	and w.event_schema_slug = ${scope.eventSchemaSlug}
	and (w.completed_revision is null or w.dirty_from is not null)
	and w.account_token = ${binding.accountToken}
	and w.plugin_revision_id = ${binding.pluginRevisionId}
	and w.processor_script_id = ${binding.processorScriptId}
	and w.config_revision_id is not distinct from ${binding.configRevisionId}`;

export const eventStreamId = (key: StreamKey) =>
	sha256Hex(
		stableStringify([key.userId, key.entityId, key.eventSchemaPluginId, key.eventSchemaSlug]),
	);

const toStreamKey = (row: {
	readonly userId: string;
	readonly entityId: string;
	readonly eventSchemaSlug: string;
	readonly eventSchemaPluginId: null | string;
	readonly sessionEntityId?: null | string | undefined;
	readonly properties?: undefined | Readonly<Record<string, unknown>>;
}): StreamSource => ({
	properties: row.properties,
	userId: UserId.make(row.userId),
	sessionEntityId: row.sessionEntityId,
	entityId: EntityId.make(row.entityId),
	eventSchemaSlug: EventSchemaSlug.make(row.eventSchemaSlug),
	eventSchemaPluginId:
		row.eventSchemaPluginId === null ? null : PluginId.make(row.eventSchemaPluginId),
});

export class EventStreamRepository extends Context.Service<EventStreamRepository>()(
	"@ryot-app/kernel-backend/modules/events/stream-repository/EventStreamRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const requireTransaction = session.requireTransaction.pipe(
				Effect.mapError(
					() => new DbError({ message: "Event stream writes require an active transaction" }),
				),
			);

			const dependencies = Effect.fn("EventStreamRepository.dependencies")(function* (
				sources: ReadonlyArray<StreamSource>,
			) {
				if (sources.length === 0) {
					return [];
				}
				return yield* session.run((db) =>
					db.execute<{
						userId: string;
						restart: boolean;
						entityId: string;
						sourceIndex: number;
						eventSchemaSlug: string;
						eventSchemaPluginId: string;
					}>(projectionDependencyTargets(projectionSources(sources)), "objects"),
				);
			});

			const lockSourceReferences = Effect.fn("EventStreamRepository.lockSourceReferences")(
				function* (sources: ReadonlyArray<StreamSource>) {
					yield* requireTransaction;
					if (sources.length > 0) {
						yield* session.run((db) =>
							db.execute(projectionSourceReferences(projectionSources(sources))),
						);
					}
				},
			);
			const sourceCandidates = Effect.fn("EventStreamRepository.sourceCandidates")(function* (
				sources: ReadonlyArray<StreamSource>,
			) {
				yield* requireTransaction;
				const ids = [
					...new Set(
						[...sources, ...(yield* dependencies(sources)).map(toStreamKey)].map(eventStreamId),
					),
				].sort();
				if (ids.length === 0) {
					return [];
				}
				return yield* session.run((db) =>
					db
						.select({
							id: schema.eventStream.id,
							projection: schema.userEventSchema.projection,
							entitySchemaSlug: schema.entity.entitySchemaSlug,
							key: {
								userId: schema.eventStream.userId,
								entityId: schema.eventStream.entityId,
								eventSchemaSlug: schema.eventStream.eventSchemaSlug,
								eventSchemaPluginId: schema.eventStream.eventSchemaPluginId,
							},
						})
						.from(schema.eventStream)
						.innerJoin(schema.user, eq(schema.user.id, schema.eventStream.userId))
						.innerJoin(schema.entity, eq(schema.entity.id, schema.eventStream.entityId))
						.innerJoin(
							schema.userEventSchema,
							and(
								eq(schema.userEventSchema.userId, schema.eventStream.userId),
								eq(schema.userEventSchema.entitySchemaSlug, schema.entity.entitySchemaSlug),
								eq(schema.userEventSchema.slug, schema.eventStream.eventSchemaSlug),
								sql`${schema.userEventSchema.pluginId} is not distinct from ${schema.eventStream.eventSchemaPluginId}`,
							),
						)
						.where(
							and(
								inArray(schema.eventStream.id, streamIds(ids)),
								isNull(schema.user.disabledAt),
								eq(schema.userEventSchema.isEffective, true),
								isNotNull(schema.userEventSchema.projection),
							),
						)
						.orderBy(asc(schema.eventStream.id)),
				);
			});

			const ensureAndLockStreams = Effect.fn("EventStreamRepository.ensureAndLockStreams")(
				function* (keys: ReadonlyArray<StreamKey>) {
					const entries = [...new Map(keys.map((key) => [eventStreamId(key), key])).entries()].sort(
						([left], [right]) => left.localeCompare(right),
					);
					if (entries.length === 0) {
						return [];
					}
					const ids = entries.map(([id]) => id);

					yield* session.run((db) =>
						db.execute(sql`
						with created as (
							insert into event_stream (id, user_id, entity_id, event_schema_slug, event_schema_plugin_id)
							select source.id, "userId", "entityId", "eventSchemaSlug", "eventSchemaPluginId"
							from jsonb_to_recordset(${JSON.stringify(entries.map(([id, key]) => ({ id, userId: key.userId, entityId: key.entityId, eventSchemaSlug: key.eventSchemaSlug, eventSchemaPluginId: key.eventSchemaPluginId })))}::jsonb)
								as source(id text, "userId" text, "entityId" text, "eventSchemaSlug" text, "eventSchemaPluginId" text)
							order by source.id collate "C" on conflict do nothing
							returning user_id, entity_id, event_schema_plugin_id, event_schema_slug
						)
						insert into event_stream_binding as b
							(user_id, event_schema_plugin_id, entity_schema_slug, event_schema_slug, revision)
						select distinct c.user_id, c.event_schema_plugin_id, e.entity_schema_slug, c.event_schema_slug, 1
						from created c join entity e on e.id = c.entity_id
						where c.event_schema_plugin_id is not null
						order by 1, 2, 3, 4
						on conflict (user_id, event_schema_plugin_id, entity_schema_slug, event_schema_slug)
						do update set revision = b.revision + 1
					`),
					);

					return yield* session.run((db) =>
						db
							.select()
							.from(schema.eventStream)
							.where(inArray(schema.eventStream.id, streamIds(ids)))
							.orderBy(asc(schema.eventStream.id))
							.for("update"),
					);
				},
			);
			const lock = Effect.fn("EventStreamRepository.lock")(function* (
				keys: ReadonlyArray<StreamSource>,
			) {
				yield* requireTransaction;
				yield* lockSourceReferences(keys);
				return yield* ensureAndLockStreams([
					...keys,
					...(yield* dependencies(keys)).map(toStreamKey),
				]);
			});
			const sourcesForEvents = Effect.fn("EventStreamRepository.sourcesForEvents")(function* (
				eventIds: ReadonlyArray<EventId>,
				sources: ReadonlyArray<StreamSource> = [],
			) {
				yield* requireTransaction;
				const ids = [...new Set(eventIds)].sort();
				if (ids.length === 0) {
					return sources;
				}
				const rows = yield* session.run((db) =>
					db
						.select({
							userId: schema.event.userId,
							entityId: schema.event.entityId,
							properties: schema.event.properties,
							sessionEntityId: schema.event.sessionEntityId,
							eventSchemaSlug: schema.event.eventSchemaSlug,
							eventSchemaPluginId: schema.event.eventSchemaPluginId,
						})
						.from(schema.event)
						.where(inArray(schema.event.id, ids))
						.orderBy(asc(schema.event.id)),
				);
				return [...sources, ...rows.map(toStreamKey)];
			});
			const lockSourceReferencesForEvents = Effect.fn(
				"EventStreamRepository.lockSourceReferencesForEvents",
			)(function* (eventIds: ReadonlyArray<EventId>, sources: ReadonlyArray<StreamSource> = []) {
				yield* lockSourceReferences(yield* sourcesForEvents(eventIds, sources));
			});
			const lockForEvents = Effect.fn("EventStreamRepository.lockForEvents")(function* (
				eventIds: ReadonlyArray<EventId>,
				sources: ReadonlyArray<StreamSource> = [],
			) {
				yield* lock(yield* sourcesForEvents(eventIds, sources));
			});

			const lockWorkRows = Effect.fn("EventStreamRepository.lockWorkRows")(function* (
				ids: ReadonlyArray<string>,
			) {
				if (ids.length === 0) {
					return [];
				}
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.eventStreamWork)
						.where(inArray(schema.eventStreamWork.id, streamIds(ids)))
						.orderBy(asc(schema.eventStreamWork.id))
						.for("update"),
				);
			});

			const incrementStreams = Effect.fn("EventStreamRepository.incrementStreams")(function* (
				streams: ReadonlyArray<typeof schema.eventStream.$inferSelect>,
				now: Date,
			) {
				if (streams.length > 0) {
					yield* session.run((db) =>
						db
							.update(schema.eventStream)
							.set({ updatedAt: now, revision: sql`${schema.eventStream.revision} + 1` })
							.where(inArray(schema.eventStream.id, streamIds(streams.map(({ id }) => id)))),
					);
				}
			});

			const listStreamsForEntity = Effect.fn("EventStreamRepository.listStreamsForEntity")(
				function* (entityId: EntityId) {
					const rows = yield* session.run((db) =>
						db
							.selectDistinct({
								userId: schema.event.userId,
								entityId: schema.event.entityId,
								properties: schema.event.properties,
								sessionEntityId: schema.event.sessionEntityId,
								eventSchemaSlug: schema.event.eventSchemaSlug,
								eventSchemaPluginId: schema.event.eventSchemaPluginId,
							})
							.from(schema.event)
							.where(
								or(eq(schema.event.entityId, entityId), eq(schema.event.sessionEntityId, entityId)),
							),
					);

					return rows.map((row) => ({
						properties: row.properties,
						userId: UserId.make(row.userId),
						sessionEntityId: row.sessionEntityId,
						entityId: EntityId.make(row.entityId),
						eventSchemaSlug: EventSchemaSlug.make(row.eventSchemaSlug),
						eventSchemaPluginId:
							row.eventSchemaPluginId === null ? null : PluginId.make(row.eventSchemaPluginId),
					}));
				},
			);

			const touch = Effect.fn("EventStreamRepository.touch")(function* (
				keys: ReadonlyArray<StreamTouch>,
			) {
				yield* requireTransaction;
				yield* lockSourceReferences(keys);
				const related = yield* dependencies(keys);
				const reset = new Set<string>();
				const touches = [...keys];
				for (const row of related) {
					const source = keys[row.sourceIndex];
					if (!source) {
						continue;
					}
					const key = toStreamKey(row);
					touches.push({ ...key, occurredAt: source.occurredAt });
					if (row.restart || eventStreamId(key) !== eventStreamId(source)) {
						reset.add(eventStreamId(key));
					}
				}
				const occurredAtById = new Map<string, { occurredAt: Date; readonly key: StreamKey }>();
				for (const { occurredAt, ...key } of touches) {
					const id = eventStreamId(key);
					const current = occurredAtById.get(id);
					if (!current || occurredAt.getTime() < current.occurredAt.getTime()) {
						occurredAtById.set(id, { key, occurredAt });
					}
				}
				if (occurredAtById.size === 0) {
					return;
				}

				const streams = yield* ensureAndLockStreams(
					[...occurredAtById.values()].map(({ key }) => key),
				);
				const now = yield* DateTime.nowAsDate;
				yield* incrementStreams(streams, now);
				const workRows = yield* lockWorkRows(streams.map((stream) => stream.id));
				const workById = new Map(workRows.map((work) => [work.id, work]));
				const updates: Array<
					{ reset: boolean; dirtyFrom: null | string } & Pick<
						typeof schema.eventStreamWork.$inferSelect,
						"id" | "checkpoint"
					>
				> = [];

				for (const stream of streams) {
					const work = workById.get(stream.id);
					if (!work) {
						continue;
					}
					const occurredAt = occurredAtById.get(stream.id)?.occurredAt;
					if (!occurredAt) {
						continue;
					}
					let dirtyFrom = work.dirtyFrom;
					if (dirtyFrom === null && work.completedRevision === stream.revision) {
						dirtyFrom = occurredAt;
					} else if (dirtyFrom !== null && occurredAt < dirtyFrom) {
						dirtyFrom = occurredAt;
					}
					const checkpoint =
						!reset.has(stream.id) && work.completedRevision === stream.revision
							? work.checkpoint
							: null;
					if (reset.has(stream.id)) {
						dirtyFrom = null;
					}

					updates.push({
						checkpoint,
						id: stream.id,
						reset: reset.has(stream.id),
						dirtyFrom: dirtyFrom?.toISOString() ?? null,
					});
				}
				if (updates.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`
						update event_stream_work w set dirty_from = changed."dirtyFrom",
							completed_revision = case when changed.reset then null else w.completed_revision end,
							checkpoint = changed.checkpoint, updated_at = ${now}, current_job_id = null
						from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
							as changed(id text, checkpoint jsonb, "dirtyFrom" timestamptz, reset boolean)
						where w.id = changed.id
					`),
					);
				}
			});

			const invalidateEntity = Effect.fn("EventStreamRepository.invalidateEntity")(function* (
				entityId: EntityId,
			) {
				yield* requireTransaction;
				const keys = yield* listStreamsForEntity(entityId);
				const streams = yield* lock(keys);
				if (streams.length === 0) {
					return;
				}

				const now = yield* DateTime.nowAsDate;
				yield* incrementStreams(streams, now);
				const ids = streams.map((stream) => stream.id);
				yield* lockWorkRows(ids);
				yield* session.run((db) =>
					db.execute(sql`
						update event_stream_work w set updated_at = ${now}, dirty_from = null, checkpoint = null,
							completed_revision = null, current_job_id = null
						where w.id in ${streamIds(ids)}
					`),
				);
			});

			const bindingDeclarations = Effect.fn("EventStreamRepository.bindingDeclarations")(
				function* (input: { limit: number; after?: EventStreamBindingKey }) {
					const after = input.after;
					return yield* session.run((db) =>
						db.execute<EventStreamBindingDeclaration & { projection: PluginEventProjection }>(
							sql`select d.user_id as "userId", d.plugin_id as "eventSchemaPluginId",
								d.entity_schema_slug as "entitySchemaSlug", d.slug as "eventSchemaSlug", d.projection,
								up.active_revision_id as "pluginRevisionId", up.config_revision_id as "configRevisionId",
								u.account_generation as "accountToken", coalesce(b.revision, 0) as "revision"
								from ${schema.userEventSchema} d
								inner join "user" u on u.id = d.user_id and u.disabled_at is null
								inner join ${schema.userPlugin} up on up.user_id = d.user_id and up.plugin_id = d.plugin_id
									and up.is_executable and up.active_revision_id is not null
								left join ${schema.eventStreamBinding} b on b.user_id = d.user_id
									and b.event_schema_plugin_id = d.plugin_id and b.entity_schema_slug = d.entity_schema_slug
									and b.event_schema_slug = d.slug
								where d.is_effective and d.projection is not null
								${after ? sql`and (d.user_id, d.plugin_id, d.entity_schema_slug, d.slug) > (${after.userId}, ${after.eventSchemaPluginId}, ${after.entitySchemaSlug}, ${after.eventSchemaSlug})` : sql``}
								and (b.user_id is null or b.bound_revision is distinct from b.revision
									or b.account_token is distinct from u.account_generation
									or b.plugin_revision_id is distinct from up.active_revision_id
									or b.config_revision_id is distinct from up.config_revision_id)
								order by d.user_id, d.plugin_id, d.entity_schema_slug, d.slug
								limit ${input.limit}`,
							"objects",
						),
					);
				},
			);

			const recordBinding = Effect.fn("EventStreamRepository.recordBinding")(function* ({
				revision,
				...declaration
			}: EventStreamBindingDeclaration) {
				yield* session.run((db) =>
					db
						.insert(schema.eventStreamBinding)
						.values({ ...declaration, boundRevision: revision })
						.onConflictDoUpdate({
							setWhere: eq(schema.eventStreamBinding.revision, revision),
							set: {
								boundRevision: revision,
								accountToken: declaration.accountToken,
								pluginRevisionId: declaration.pluginRevisionId,
								configRevisionId: declaration.configRevisionId,
							},
							target: [
								schema.eventStreamBinding.userId,
								schema.eventStreamBinding.eventSchemaPluginId,
								schema.eventStreamBinding.entitySchemaSlug,
								schema.eventStreamBinding.eventSchemaSlug,
							],
						}),
				);
			});

			const declared = Effect.fn("EventStreamRepository.declared")(function* (
				scope: EventStreamScope,
				scriptSlug: string,
			) {
				const rows = yield* session.run((db) =>
					db
						.select({ slug: schema.userEventSchema.slug })
						.from(schema.userEventSchema)
						.where(
							and(
								eq(schema.userEventSchema.userId, scope.userId),
								eq(schema.userEventSchema.pluginId, scope.eventSchemaPluginId),
								eq(schema.userEventSchema.slug, scope.eventSchemaSlug),
								eq(schema.userEventSchema.isEffective, true),
								sql`${schema.userEventSchema.projection} ->> 'scriptSlug' = ${scriptSlug}`,
							),
						)
						.limit(1),
				);
				return rows.length > 0;
			});

			const bind = Effect.fn("EventStreamRepository.bind")(function* (input: {
				limit: number;
				after?: string;
				outputSchema: AppSchema;
				streamIds?: ReadonlyArray<string>;
				declaration: EventStreamBindingKey;
				binding: EventStreamBinding & { readonly pluginPin: JsonValue };
			}) {
				yield* requireTransaction;
				const { binding, declaration } = input;
				const encode = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
				const pluginPin = yield* encode(binding.pluginPin).pipe(Effect.orDie);
				const outputSchema = yield* encode(input.outputSchema).pipe(Effect.orDie);
				const now = yield* DateTime.nowAsDate;
				const rows = yield* session.run((db) =>
					db.execute<{ id: string }>(
						sql`with target as (
							select s.id, s.user_id, s.event_schema_plugin_id, s.event_schema_slug
							from event_stream s
							join entity e on e.id = s.entity_id
							left join event_stream_work w on w.id = s.id
							where s.user_id = ${declaration.userId}
								and s.event_schema_plugin_id = ${declaration.eventSchemaPluginId}
								and s.event_schema_slug = ${declaration.eventSchemaSlug}
								and e.entity_schema_slug = ${declaration.entitySchemaSlug}
								${input.streamIds === undefined ? sql`` : sql`and s.id in ${streamIds(input.streamIds)}`}
								${input.after === undefined ? sql`` : sql`and s.id > ${input.after}`}
								and (w.id is null or w.account_token is distinct from ${binding.accountToken}
									or w.plugin_revision_id is distinct from ${binding.pluginRevisionId}
									or w.processor_script_id is distinct from ${binding.processorScriptId}
									or w.plugin_pin is distinct from ${pluginPin}::jsonb
									or w.output_schema is distinct from ${outputSchema}::jsonb)
							order by s.id
							limit ${input.limit}
							for update of s
						)
						insert into event_stream_work as w (id, user_id, event_schema_plugin_id, event_schema_slug,
							account_token, plugin_revision_id, processor_script_id, plugin_pin, output_schema, updated_at)
						select id, user_id, event_schema_plugin_id, event_schema_slug, ${binding.accountToken},
							${binding.pluginRevisionId}, ${binding.processorScriptId}, ${pluginPin}::jsonb,
							${outputSchema}::jsonb, ${now}
						from target order by id
						on conflict (id) do update set account_token = excluded.account_token,
							plugin_revision_id = excluded.plugin_revision_id,
							processor_script_id = excluded.processor_script_id, plugin_pin = excluded.plugin_pin,
							output_schema = excluded.output_schema, updated_at = excluded.updated_at,
							checkpoint = null, dirty_from = null, completed_revision = null, current_job_id = null
						returning w.id`,
						"objects",
					),
				);
				return rows.map(({ id }) => id).sort();
			});

			const retry = Effect.fn("EventStreamRepository.retry")(function* (id: string) {
				yield* requireTransaction;
				yield* session.run((db) =>
					db.execute(sql`update event_stream_work w set current_job_id = null
						where w.id = ${id} and ${failedJob(sql`w.current_job_id`)}`),
				);
			});

			const claimable = Effect.fn("EventStreamRepository.claimable")(function* (
				scope: EventStreamScope,
				binding: EventStreamBinding,
			) {
				const rows = yield* session.run((db) =>
					db.execute<{ id: string }>(
						sql`select w.id from event_stream_work w
							where ${dirtyInScope(scope, binding)}
								and (not ${failedJob(sql`w.current_job_id`)} or ${failedInBatch})
							limit 1`,
						"objects",
					),
				);
				return rows.length > 0;
			});

			const claim = Effect.fn("EventStreamRepository.claim")(function* (input: {
				jobId: string;
				limit: number;
				scope: EventStreamScope;
				binding: EventStreamBinding;
			}) {
				yield* requireTransaction;
				const select = (predicate: SQL, limit: number) =>
					session.run((db) =>
						db.execute<{
							id: string;
							revision: number;
							entityId: string;
							checkpoint: JsonValue;
							outputSchema: AppSchema;
							dirtyFrom: null | string;
						}>(
							sql`select w.id, s.revision, s.entity_id as "entityId", w.checkpoint,
								w.output_schema as "outputSchema",
								to_char(w.dirty_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "dirtyFrom"
								from event_stream_work w join event_stream s on s.id = w.id
								where ${dirtyInScope(input.scope, input.binding)} and ${predicate}
								order by w.id limit ${limit}
								for update of s, w skip locked`,
							"objects",
						),
					);
				const retried = yield* select(failedInBatch, 1);
				const claimed =
					retried.length > 0
						? retried
						: yield* select(sql`not ${failedJob(sql`w.current_job_id`)}`, input.limit);
				if (claimed.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`update event_stream_work set current_job_id = ${input.jobId},
							claimed_alone = ${claimed.length === 1} where id in ${streamIds(claimed.map(({ id }) => id))}`),
					);
				}
				return claimed;
			});

			const currentClaims = Effect.fn("EventStreamRepository.currentClaims")(function* (
				jobId: string,
				claims: ReadonlyArray<{ readonly id: string; readonly revision: number }>,
			) {
				yield* requireTransaction;
				const rows = yield* session.run((db) =>
					db.execute<{ id: string }>(
						sql`select w.id from event_stream_work w
							join event_stream s on s.id = w.id
							join jsonb_to_recordset(${JSON.stringify(claims)}::jsonb) as c(id text, revision integer)
								on c.id = w.id and c.revision = s.revision
							where w.current_job_id = ${jobId}
							order by w.id
							for update of s, w`,
						"objects",
					),
				);
				const [job] = yield* session.run((db) =>
					db
						.select({ status: schema.backgroundWork.status })
						.from(schema.backgroundWork)
						.where(eq(schema.backgroundWork.id, jobId))
						.for("update"),
				);
				return job?.status === "running" ? rows.map(({ id }) => id) : [];
			});

			const finish = Effect.fn("EventStreamRepository.finish")(function* (
				jobId: string,
				results: ReadonlyArray<{
					readonly id: string;
					readonly done: boolean;
					readonly revision: number;
					readonly checkpoint: JsonValue;
				}>,
			) {
				yield* requireTransaction;
				if (results.length === 0) {
					return;
				}
				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db.execute(sql`update event_stream_work w set checkpoint = r.checkpoint, updated_at = ${now},
						completed_revision = case when r.done then r.revision end,
						dirty_from = case when r.done then null else w.dirty_from end
						from jsonb_to_recordset(${JSON.stringify(results)}::jsonb)
							as r(id text, done boolean, revision integer, checkpoint jsonb)
						where w.id = r.id and w.current_job_id = ${jobId}`),
				);
			});

			const dirtyScopes = Effect.fn("EventStreamRepository.dirtyScopes")(function* (input: {
				limit: number;
				after?: EventStreamScope;
			}) {
				const { after } = input;
				const dirty = sql`(w.completed_revision is null or w.dirty_from is not null)`;
				const key = sql`(w.user_id, w.event_schema_plugin_id, w.event_schema_slug)`;
				return yield* session.run((db) =>
					db.execute<EventStreamScope & { scriptSlugs: ReadonlyArray<string> }>(
						sql`with recursive groups as (
							(select w.user_id, w.event_schema_plugin_id, w.event_schema_slug
								from event_stream_work w where ${dirty}
								${after ? sql`and ${key} > (${after.userId}, ${after.eventSchemaPluginId}, ${after.eventSchemaSlug})` : sql``}
								order by 1, 2, 3 limit 1)
							union all
							select n.* from groups g cross join lateral (
								select w.user_id, w.event_schema_plugin_id, w.event_schema_slug
								from event_stream_work w
								where ${dirty} and ${key} > (g.user_id, g.event_schema_plugin_id, g.event_schema_slug)
								order by 1, 2, 3 limit 1
							) n
						)
						select g.user_id as "userId", g.event_schema_plugin_id as "eventSchemaPluginId",
							g.event_schema_slug as "eventSchemaSlug", coalesce((
								select array_agg(distinct d.projection ->> 'scriptSlug') from user_event_schema d
								join "user" u on u.id = d.user_id and u.disabled_at is null
								where d.user_id = g.user_id and d.plugin_id = g.event_schema_plugin_id
									and d.slug = g.event_schema_slug and d.is_effective and d.projection is not null
									and not exists (
										select 1 from background_work j
										where j.user_id = g.user_id and j.plugin_id = g.event_schema_plugin_id
											and j.purpose = 'event-projection' and j.scope = g.event_schema_slug
											and j.status in ('queued', 'running')
									)
							), '{}') as "scriptSlugs"
						from (select * from groups limit ${input.limit}) g
						order by 1, 2, 3`,
						"objects",
					),
				);
			});

			return {
				bind,
				lock,
				claim,
				retry,
				touch,
				finish,
				declared,
				claimable,
				dirtyScopes,
				currentClaims,
				lockForEvents,
				recordBinding,
				invalidateEntity,
				sourceCandidates,
				bindingDeclarations,
				lockSourceReferences,
				lockSourceReferencesForEvents,
				ensureStreams: ensureAndLockStreams,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
