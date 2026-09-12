import { DbError } from "@ryot-app/contract/errors";
import {
	EntityId,
	type EventId,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

export const StreamKeySchema = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	eventSchemaSlug: EventSchemaSlug,
	eventSchemaPluginId: Schema.NullOr(PluginId),
});

export type StreamKey = typeof StreamKeySchema.Type;

type StreamTouch = StreamKey & { readonly occurredAt: Date };

const streamId = (key: StreamKey) =>
	sha256Hex(
		stableStringify([key.userId, key.entityId, key.eventSchemaPluginId, key.eventSchemaSlug]),
	);

const toStreamKey = (row: {
	readonly userId: string;
	readonly entityId: string;
	readonly eventSchemaSlug: string;
	readonly eventSchemaPluginId: string | null;
}): StreamKey => ({
	userId: UserId.make(row.userId),
	entityId: EntityId.make(row.entityId),
	eventSchemaSlug: EventSchemaSlug.make(row.eventSchemaSlug),
	eventSchemaPluginId:
		row.eventSchemaPluginId === null ? null : PluginId.make(row.eventSchemaPluginId),
});

const currentSelection = {
	id: schema.eventStreamWork.id,
	error: schema.eventStreamWork.error,
	status: schema.eventStreamWork.status,
	attempt: schema.eventStreamWork.attempt,
	pluginPin: schema.eventStreamWork.pluginPin,
	streamRevision: schema.eventStream.revision,
	dirtyFrom: schema.eventStreamWork.dirtyFrom,
	updatedAt: schema.eventStreamWork.updatedAt,
	checkpoint: schema.eventStreamWork.checkpoint,
	accountToken: schema.eventStreamWork.accountToken,
	claimedRevision: schema.eventStreamWork.claimedRevision,
	pluginRevisionId: schema.eventStreamWork.pluginRevisionId,
	outputProperties: schema.eventStreamWork.outputProperties,
	processorScriptId: schema.eventStreamWork.processorScriptId,
	key: {
		userId: schema.eventStream.userId,
		entityId: schema.eventStream.entityId,
		eventSchemaSlug: schema.eventStream.eventSchemaSlug,
		eventSchemaPluginId: schema.eventStream.eventSchemaPluginId,
	},
};

export class EventStreamRepository extends Context.Service<EventStreamRepository>()(
	"EventStreamRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const requireTransaction = session.requireTransaction.pipe(
				Effect.mapError(
					() => new DbError({ message: "Event stream writes require an active transaction" }),
				),
			);

			const ensureAndLockStreams = Effect.fn("EventStreamRepository.ensureAndLockStreams")(
				function* (keys: ReadonlyArray<StreamKey>) {
					const entries = [...new Map(keys.map((key) => [streamId(key), key])).entries()].sort(
						([left], [right]) => left.localeCompare(right),
					);
					if (entries.length === 0) {
						return [];
					}
					const ids = entries.map(([id]) => id);

					yield* session.run((db) =>
						db
							.insert(schema.eventStream)
							.values(
								entries.map(([id, key]) => ({
									id,
									userId: key.userId,
									entityId: key.entityId,
									eventSchemaSlug: key.eventSchemaSlug,
									eventSchemaPluginId: key.eventSchemaPluginId,
								})),
							)
							.onConflictDoNothing(),
					);

					return yield* session.run((db) =>
						db
							.select()
							.from(schema.eventStream)
							.where(inArray(schema.eventStream.id, ids))
							.orderBy(asc(schema.eventStream.id))
							.for("update"),
					);
				},
			);
			const lock = Effect.fn("EventStreamRepository.lock")(function* (
				keys: ReadonlyArray<StreamKey>,
			) {
				yield* requireTransaction;
				return yield* ensureAndLockStreams(keys);
			});
			const lockForEvents = Effect.fn("EventStreamRepository.lockForEvents")(function* (
				eventIds: ReadonlyArray<EventId>,
			) {
				yield* requireTransaction;
				const ids = [...new Set(eventIds)].sort();
				if (ids.length === 0) {
					return;
				}
				const rows = yield* session.run((db) =>
					db
						.select({
							userId: schema.event.userId,
							entityId: schema.event.entityId,
							eventSchemaSlug: schema.event.eventSchemaSlug,
							eventSchemaPluginId: schema.event.eventSchemaPluginId,
						})
						.from(schema.event)
						.where(inArray(schema.event.id, ids))
						.orderBy(asc(schema.event.id)),
				);
				yield* lock(rows.map(toStreamKey));
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
						.where(inArray(schema.eventStreamWork.id, ids))
						.orderBy(asc(schema.eventStreamWork.id))
						.for("update"),
				);
			});

			const incrementStreams = Effect.fn("EventStreamRepository.incrementStreams")(function* (
				streams: ReadonlyArray<typeof schema.eventStream.$inferSelect>,
				now: Date,
			) {
				for (const stream of streams) {
					yield* session.run((db) =>
						db
							.update(schema.eventStream)
							.set({ updatedAt: now, revision: sql`${schema.eventStream.revision} + 1` })
							.where(eq(schema.eventStream.id, stream.id)),
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
								eventSchemaSlug: schema.event.eventSchemaSlug,
								eventSchemaPluginId: schema.event.eventSchemaPluginId,
							})
							.from(schema.event)
							.where(
								or(eq(schema.event.entityId, entityId), eq(schema.event.sessionEntityId, entityId)),
							),
					);

					return rows.map((row) => ({
						userId: UserId.make(row.userId),
						entityId: EntityId.make(row.entityId),
						eventSchemaSlug: EventSchemaSlug.make(row.eventSchemaSlug),
						eventSchemaPluginId:
							row.eventSchemaPluginId === null ? null : PluginId.make(row.eventSchemaPluginId),
					}));
				},
			);

			const touch = Effect.fn("EventStreamRepository.touch")(function* (
				keys: ReadonlyArray<StreamTouch>,
				ownerWorkId?: string,
			) {
				yield* requireTransaction;
				const occurredAtById = new Map<string, { readonly key: StreamKey; occurredAt: Date }>();
				for (const { occurredAt, ...key } of keys) {
					const id = streamId(key);
					const current = occurredAtById.get(id);
					if (!current || occurredAt.getTime() < current.occurredAt.getTime()) {
						occurredAtById.set(id, { key, occurredAt });
					}
				}
				if (occurredAtById.size === 0) {
					return;
				}

				const streams = yield* lock([...occurredAtById.values()].map(({ key }) => key));
				const now = yield* DateTime.nowAsDate;
				yield* incrementStreams(streams, now);
				const workRows = yield* lockWorkRows(streams.map((stream) => stream.id));
				const workById = new Map(workRows.map((work) => [work.id, work]));

				for (const stream of streams) {
					if (ownerWorkId === stream.id) {
						continue;
					}
					const work = workById.get(stream.id);
					if (!work) {
						continue;
					}
					const occurredAt = occurredAtById.get(stream.id)?.occurredAt;
					if (!occurredAt) {
						continue;
					}
					let dirtyFrom = work.dirtyFrom;
					if (dirtyFrom === null && work.status === "completed") {
						dirtyFrom = occurredAt;
					} else if (dirtyFrom !== null && occurredAt < dirtyFrom) {
						dirtyFrom = occurredAt;
					}
					const checkpoint = work.status === "completed" ? work.checkpoint : null;

					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({ dirtyFrom, checkpoint, error: null, updatedAt: now, status: "queued" })
							.where(eq(schema.eventStreamWork.id, stream.id)),
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
				const workRows = yield* lockWorkRows(streams.map((stream) => stream.id));
				for (const work of workRows) {
					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({
								error: null,
								updatedAt: now,
								dirtyFrom: null,
								status: "queued",
								checkpoint: null,
							})
							.where(eq(schema.eventStreamWork.id, work.id)),
					);
				}
			});

			const request = Effect.fn("EventStreamRepository.request")(function* (input: {
				key: StreamKey;
				processorScriptId: string;
				pluginRevisionId: string;
				accountToken: string;
				outputProperties: ReadonlyArray<string>;
				pluginPin: JsonValue;
			}) {
				yield* requireTransaction;
				const id = streamId(input.key);
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
							status: "queued",
							pluginPin: input.pluginPin,
							accountToken: input.accountToken,
							pluginRevisionId: input.pluginRevisionId,
							outputProperties: input.outputProperties,
							processorScriptId: input.processorScriptId,
						})
						.onConflictDoNothing(),
				);

				const work = yield* lockWork(id);
				if (!work) {
					return yield* new DbError({ message: "Event stream work insert returned no row" });
				}

				const changedBinding =
					work.processorScriptId !== input.processorScriptId ||
					work.pluginRevisionId !== input.pluginRevisionId ||
					stableStringify(work.outputProperties) !== stableStringify(input.outputProperties);
				const staleCompletion =
					work.status === "completed" &&
					work.claimedRevision !== null &&
					stream.revision > work.claimedRevision;
				if (changedBinding) {
					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({
								error: null,
								updatedAt: now,
								dirtyFrom: null,
								checkpoint: null,
								status: "queued",
								claimedRevision: null,
								pluginPin: input.pluginPin,
								accountToken: input.accountToken,
								pluginRevisionId: input.pluginRevisionId,
								outputProperties: input.outputProperties,
								processorScriptId: input.processorScriptId,
							})
							.where(eq(schema.eventStreamWork.id, id)),
					);
				} else if (work.status === "failed") {
					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({
								error: null,
								updatedAt: now,
								status: "queued",
								accountToken: input.accountToken,
								outputProperties: input.outputProperties,
							})
							.where(eq(schema.eventStreamWork.id, id)),
					);
				} else if (staleCompletion) {
					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({
								error: null,
								updatedAt: now,
								dirtyFrom: null,
								checkpoint: null,
								status: "queued",
								accountToken: input.accountToken,
								outputProperties: input.outputProperties,
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
								outputProperties: input.outputProperties,
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
				limit = 100,
			) {
				return yield* session.run((db) =>
					db
						.select(currentSelection)
						.from(schema.eventStreamWork)
						.innerJoin(schema.eventStream, eq(schema.eventStream.id, schema.eventStreamWork.id))
						.where(inArray(schema.eventStreamWork.status, ["queued", "running"]))
						.orderBy(asc(schema.eventStreamWork.updatedAt), asc(schema.eventStreamWork.id))
						.limit(limit),
				);
			});

			const claim = Effect.fn("EventStreamRepository.claim")(function* (
				id: string,
				expectedAttempt?: number,
			) {
				yield* requireTransaction;
				const stream = yield* lockStream(id);
				if (!stream) {
					return null;
				}
				const work = yield* lockWork(id);
				if (
					!work ||
					(expectedAttempt !== undefined &&
						work.attempt !== expectedAttempt &&
						!(work.status === "running" && work.attempt === expectedAttempt + 1))
				) {
					return null;
				}
				if (work.status === "running") {
					return yield* readState(id);
				}
				if (work.status !== "queued") {
					return null;
				}

				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(schema.eventStreamWork)
						.set({
							updatedAt: now,
							status: "running",
							attempt: work.attempt + 1,
							claimedRevision: stream.revision,
						})
						.where(eq(schema.eventStreamWork.id, id)),
				);
				return yield* readState(id);
			});

			const currentClaim = Effect.fn("EventStreamRepository.currentClaim")(function* (
				id: string,
				attempt: number,
				revision: number,
			) {
				yield* requireTransaction;
				const stream = yield* lockStream(id);
				if (!stream) {
					return false;
				}
				const work = yield* lockWork(id);
				return (
					work?.status === "running" && work.attempt === attempt && stream.revision === revision
				);
			});

			const finish = Effect.fn("EventStreamRepository.finish")(function* (
				id: string,
				attempt: number,
				checkpoint: JsonValue,
				done: boolean,
			) {
				yield* requireTransaction;
				const stream = yield* lockStream(id);
				if (!stream) {
					return false;
				}
				const work = yield* lockWork(id);
				if (work?.status !== "running" || work.attempt !== attempt) {
					return false;
				}

				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(schema.eventStreamWork)
						.set({
							checkpoint,
							error: null,
							updatedAt: now,
							claimedRevision: stream.revision,
							status: done ? "completed" : "queued",
							dirtyFrom: done ? null : work.dirtyFrom,
						})
						.where(eq(schema.eventStreamWork.id, id)),
				);
				return true;
			});

			const fail = Effect.fn("EventStreamRepository.fail")(function* (
				id: string,
				attempt: number,
				message: string,
			) {
				yield* requireTransaction;
				const stream = yield* lockStream(id);
				if (!stream) {
					return false;
				}
				const work = yield* lockWork(id);
				if (work?.status !== "running" || work.attempt !== attempt) {
					return false;
				}

				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(schema.eventStreamWork)
						.set({ error: message, updatedAt: now, status: "failed" })
						.where(eq(schema.eventStreamWork.id, id)),
				);
				return true;
			});

			return {
				get,
				fail,
				lock,
				touch,
				claim,
				finish,
				request,
				currentClaim,
				lockForEvents,
				listCandidates,
				invalidateEntity,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
