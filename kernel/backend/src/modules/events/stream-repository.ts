import { DbError } from "@ryot-app/contract/errors";
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
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { sameProjectionBinding } from "#modules/scripts/executions/projection-bindings";
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

export type StreamSource = StreamKey & {
	readonly sessionEntityId?: null | string | undefined;
	readonly properties?: undefined | Readonly<Record<string, unknown>>;
};

type StreamTouch = StreamSource & { readonly occurredAt: Date };

const streamIds = (ids: ReadonlyArray<string>) =>
	sql`(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;

const retainedQueuedJob = (
	currentJobId: SQL | AnyPgColumn,
) => sql`(select job.id from background_work job
	where job.id = ${currentJobId} and job.status = 'queued')`;

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

const currentSelection = {
	id: schema.eventStreamWork.id,
	step: schema.eventStreamWork.step,
	error: schema.backgroundWork.error,
	status: schema.backgroundWork.status,
	pluginPin: schema.eventStreamWork.pluginPin,
	streamRevision: schema.eventStream.revision,
	dirtyFrom: schema.eventStreamWork.dirtyFrom,
	updatedAt: schema.eventStreamWork.updatedAt,
	checkpoint: schema.eventStreamWork.checkpoint,
	currentJobId: schema.eventStreamWork.currentJobId,
	accountToken: schema.eventStreamWork.accountToken,
	outputSchema: schema.eventStreamWork.outputSchema,
	pluginRevisionId: schema.eventStreamWork.pluginRevisionId,
	completedRevision: schema.eventStreamWork.completedRevision,
	processorScriptId: schema.eventStreamWork.processorScriptId,
	key: {
		userId: schema.eventStream.userId,
		entityId: schema.eventStream.entityId,
		eventSchemaSlug: schema.eventStream.eventSchemaSlug,
		eventSchemaPluginId: schema.eventStream.eventSchemaPluginId,
	},
};

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
						insert into event_stream (id, user_id, entity_id, event_schema_slug, event_schema_plugin_id)
						select source.id, "userId", "entityId", "eventSchemaSlug", "eventSchemaPluginId"
						from jsonb_to_recordset(${JSON.stringify(entries.map(([id, key]) => ({ id, userId: key.userId, entityId: key.entityId, eventSchemaSlug: key.eventSchemaSlug, eventSchemaPluginId: key.eventSchemaPluginId })))}::jsonb)
							as source(id text, "userId" text, "entityId" text, "eventSchemaSlug" text, "eventSchemaPluginId" text)
						order by source.id collate "C" on conflict do nothing
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

			const readState = (id: string) =>
				session
					.run((db) =>
						db
							.select(currentSelection)
							.from(schema.eventStreamWork)
							.innerJoin(schema.eventStream, eq(schema.eventStream.id, schema.eventStreamWork.id))
							.leftJoin(
								schema.backgroundWork,
								eq(schema.backgroundWork.id, schema.eventStreamWork.currentJobId),
							)
							.where(eq(schema.eventStreamWork.id, id))
							.limit(1),
					)
					.pipe(Effect.map((rows) => rows[0] ?? null));

			const lockStream = (id: string) =>
				session
					.run((db) =>
						db
							.select()
							.from(schema.eventStream)
							.where(eq(schema.eventStream.id, id))
							.limit(1)
							.for("update"),
					)
					.pipe(Effect.map((rows) => rows[0] ?? null));

			const lockWork = (id: string) =>
				lockWorkRows([id]).pipe(Effect.map((rows) => rows[0] ?? null));

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
					{ dirtyFrom: null | string } & Pick<
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

					updates.push({ checkpoint, id: stream.id, dirtyFrom: dirtyFrom?.toISOString() ?? null });
				}
				if (updates.length > 0) {
					yield* session.run((db) =>
						db.execute(sql`
						update event_stream_work w set dirty_from = changed."dirtyFrom",
							checkpoint = changed.checkpoint, updated_at = ${now}, current_job_id = ${retainedQueuedJob(sql`w.current_job_id`)}
						from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
							as changed(id text, checkpoint jsonb, "dirtyFrom" timestamptz)
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
							current_job_id = ${retainedQueuedJob(sql`w.current_job_id`)}
						where w.id in ${streamIds(ids)}
					`),
				);
			});

			const request = Effect.fn("EventStreamRepository.request")(function* (input: {
				key: StreamKey;
				accountToken: string;
				pluginPin: JsonValue;
				outputSchema: AppSchema;
				pluginRevisionId: string;
				processorScriptId: string;
			}) {
				yield* requireTransaction;
				const id = eventStreamId(input.key);
				const [stream] = yield* ensureAndLockStreams([input.key]);
				if (!stream) {
					return yield* new DbError({ message: "Event stream insert returned no row" });
				}

				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.insert(schema.eventStreamWork)
						.values({
							id,
							dirtyFrom: null,
							checkpoint: null,
							pluginPin: input.pluginPin,
							accountToken: input.accountToken,
							outputSchema: input.outputSchema,
							pluginRevisionId: input.pluginRevisionId,
							processorScriptId: input.processorScriptId,
						})
						.onConflictDoNothing(),
				);

				const work = yield* lockWork(id);
				if (!work) {
					return yield* new DbError({ message: "Event stream work insert returned no row" });
				}

				const changedBinding = !sameProjectionBinding(work, input);
				if (changedBinding) {
					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({
								updatedAt: now,
								dirtyFrom: null,
								checkpoint: null,
								completedRevision: null,
								pluginPin: input.pluginPin,
								accountToken: input.accountToken,
								outputSchema: input.outputSchema,
								pluginRevisionId: input.pluginRevisionId,
								processorScriptId: input.processorScriptId,
								currentJobId: retainedQueuedJob(schema.eventStreamWork.currentJobId),
							})
							.where(eq(schema.eventStreamWork.id, id)),
					);
				} else {
					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({
								updatedAt: now,
								accountToken: input.accountToken,
								outputSchema: input.outputSchema,
							})
							.where(eq(schema.eventStreamWork.id, id)),
					);
				}

				return id;
			});

			const get = Effect.fn("EventStreamRepository.get")(function* (id: string) {
				return yield* readState(id);
			});
			const listCandidates = Effect.fn("EventStreamRepository.listCandidates")(function* (
				limit: number,
				after?: string,
			) {
				return yield* session.run((db) =>
					db
						.select(currentSelection)
						.from(schema.eventStreamWork)
						.innerJoin(schema.eventStream, eq(schema.eventStream.id, schema.eventStreamWork.id))
						.innerJoin(schema.user, eq(schema.user.id, schema.eventStream.userId))
						.leftJoin(
							schema.backgroundWork,
							eq(schema.backgroundWork.id, schema.eventStreamWork.currentJobId),
						)
						.where(
							and(
								isNull(schema.user.disabledAt),
								eq(schema.user.accountGeneration, schema.eventStreamWork.accountToken),
								isNull(schema.eventStreamWork.currentJobId),
								after === undefined ? undefined : gt(schema.eventStreamWork.id, after),
								sql`${schema.eventStreamWork.completedRevision} is distinct from ${schema.eventStream.revision}`,
							),
						)
						.orderBy(asc(schema.eventStreamWork.id))
						.limit(limit),
				);
			});

			const postponeCandidate = Effect.fn("EventStreamRepository.postponeCandidate")(function* (
				id: string,
			) {
				const updatedAt = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(schema.eventStreamWork)
						.set({ updatedAt })
						.where(
							and(eq(schema.eventStreamWork.id, id), isNull(schema.eventStreamWork.currentJobId)),
						),
				);
			});

			const bindingCandidates = Effect.fn("EventStreamRepository.bindingCandidates")(
				function* (input: { limit: number; after?: string }) {
					return yield* session.run((db) =>
						db
							.select({
								id: schema.eventStream.id,
								projection: schema.userEventSchema.projection,
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
							.innerJoin(
								schema.userPlugin,
								and(
									eq(schema.userPlugin.userId, schema.eventStream.userId),
									eq(schema.userPlugin.pluginId, schema.eventStream.eventSchemaPluginId),
									eq(schema.userPlugin.isExecutable, true),
								),
							)
							.leftJoin(
								schema.eventStreamWork,
								eq(schema.eventStreamWork.id, schema.eventStream.id),
							)
							.where(
								and(
									isNull(schema.user.disabledAt),
									eq(schema.userEventSchema.isEffective, true),
									isNotNull(schema.userEventSchema.projection),
									input.after === undefined ? undefined : gt(schema.eventStream.id, input.after),
									or(
										isNull(schema.eventStreamWork.id),
										sql`${schema.eventStreamWork.accountToken} is distinct from ${schema.user.accountGeneration}`,
										sql`${schema.eventStreamWork.pluginRevisionId} is distinct from ${schema.userPlugin.activeRevisionId}`,
										sql`${schema.eventStreamWork.pluginPin}->>'configRevisionId' is distinct from ${schema.userPlugin.configRevisionId}`,
									),
								),
							)
							.orderBy(asc(schema.eventStream.id))
							.limit(input.limit),
					);
				},
			);

			const prepare = Effect.fn("EventStreamRepository.prepare")(function* (id: string) {
				yield* requireTransaction;
				const [account] = yield* session.run((db) =>
					db
						.select({ disabledAt: schema.user.disabledAt })
						.from(schema.eventStream)
						.innerJoin(schema.user, eq(schema.user.id, schema.eventStream.userId))
						.where(eq(schema.eventStream.id, id)),
				);
				if (account?.disabledAt !== null) {
					return null;
				}
				const stream = yield* lockStream(id);
				if (!stream) {
					return null;
				}
				yield* lockWork(id);
				return yield* readState(id);
			});
			const reserve = Effect.fn("EventStreamRepository.reserve")(function* (
				id: string,
				jobId: string,
			) {
				yield* requireTransaction;
				yield* session.run((db) =>
					db
						.update(schema.eventStreamWork)
						.set({ currentJobId: jobId, step: sql`${schema.eventStreamWork.step} + 1` })
						.where(eq(schema.eventStreamWork.id, id)),
				);
			});

			const currentClaim = Effect.fn("EventStreamRepository.currentClaim")(function* (
				id: string,
				jobId: string,
				revision: number,
			) {
				yield* requireTransaction;
				const stream = yield* lockStream(id);
				if (!stream) {
					return false;
				}
				const work = yield* lockWork(id);
				const job = yield* session.run((db) =>
					db
						.select({ status: schema.backgroundWork.status })
						.from(schema.backgroundWork)
						.where(eq(schema.backgroundWork.id, jobId))
						.for("update"),
				);
				return (
					work?.currentJobId === jobId &&
					stream.revision === revision &&
					job[0]?.status === "running"
				);
			});

			const finish = Effect.fn("EventStreamRepository.finish")(function* (
				id: string,
				jobId: string,
				revision: number,
				checkpoint: JsonValue,
				done: boolean,
			) {
				yield* requireTransaction;
				if (!(yield* currentClaim(id, jobId, revision))) {
					return false;
				}

				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(schema.eventStreamWork)
						.set({
							checkpoint,
							updatedAt: now,
							completedRevision: done ? revision : null,
							...(done ? { dirtyFrom: null } : { currentJobId: null }),
						})
						.where(eq(schema.eventStreamWork.id, id)),
				);
				return true;
			});

			return {
				get,
				lock,
				touch,
				finish,
				prepare,
				reserve,
				request,
				currentClaim,
				lockForEvents,
				listCandidates,
				invalidateEntity,
				sourceCandidates,
				bindingCandidates,
				postponeCandidate,
				lockSourceReferences,
				lockSourceReferencesForEvents,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
