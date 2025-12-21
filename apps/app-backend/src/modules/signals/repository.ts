import { DbError } from "@ryot/contract/errors";
import {
	AutomationOrigin,
	type AutomationOrigin as AutomationOriginValue,
} from "@ryot/contract/modules/automations/schemas";
import { EntityId, SignalId, SignalSchemaId, UserId } from "@ryot/contract/schema/brands";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type SignalRow = typeof schema.signal.$inferSelect;

export type StoredSignal = {
	id: SignalId;
	createdAt: string;
	occurredAt: string;
	actorUserId: UserId | null;
	origin: AutomationOriginValue;
	signalSchemaId: SignalSchemaId;
	subjectEntityId: EntityId | null;
	properties: Record<string, unknown>;
};

export type InsertSignalInput = {
	id: SignalId;
	occurredAt: Date;
	actorUserId: UserId | null;
	origin: AutomationOriginValue;
	signalSchemaId: SignalSchemaId;
	subjectEntityId: EntityId | null;
	properties: Record<string, unknown>;
};

const toStoredSignal = Effect.fn(function* (row: SignalRow) {
	const origin = yield* Schema.decodeUnknown(AutomationOrigin)(row.origin).pipe(
		Effect.mapError(() => new DbError({ message: `Invalid origin for signal ${row.id}` })),
	);
	return {
		origin,
		properties: row.properties,
		id: SignalId.make(row.id),
		createdAt: row.createdAt.toISOString(),
		occurredAt: row.occurredAt.toISOString(),
		signalSchemaId: SignalSchemaId.make(row.signalSchemaId),
		actorUserId: row.actorUserId ? UserId.make(row.actorUserId) : null,
		subjectEntityId: row.subjectEntityId ? EntityId.make(row.subjectEntityId) : null,
	};
});

export class SignalsRepository extends Effect.Service<SignalsRepository>()("SignalsRepository", {
	sync: () => {
		const insert = Effect.fn("SignalsRepository.insert")(function* (input: InsertSignalInput) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.insert(schema.signal)
					.values(input)
					.onConflictDoNothing({ target: schema.signal.id })
					.returning(),
			);
			return row ? yield* toStoredSignal(row) : null;
		});

		const findById = Effect.fn("SignalsRepository.findById")(function* (id: SignalId) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db.select().from(schema.signal).where(eq(schema.signal.id, id)).limit(1),
			);
			return row ? yield* toStoredSignal(row) : null;
		});

		const insertRecipients = Effect.fn("SignalsRepository.insertRecipients")(function* (input: {
			signalId: SignalId;
			userIds: ReadonlyArray<UserId>;
		}) {
			if (input.userIds.length === 0) {
				return;
			}
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db
					.insert(schema.signalRecipient)
					.values(input.userIds.map((userId) => ({ userId, signalId: input.signalId })))
					.onConflictDoNothing(),
			);
		});

		const listRecipientUserIds = Effect.fn("SignalsRepository.listRecipientUserIds")(function* (
			signalId: SignalId,
		) {
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
				db
					.select({ userId: schema.signalRecipient.userId })
					.from(schema.signalRecipient)
					.where(eq(schema.signalRecipient.signalId, signalId))
					.orderBy(asc(schema.signalRecipient.userId)),
			);
			return rows.map((row) => UserId.make(row.userId));
		});

		const listBySchemaSlug = Effect.fn("SignalsRepository.listBySchemaSlug")(function* (input: {
			schemaSlug: string;
			actorUserId?: UserId | undefined;
			subjectEntityId?: EntityId | undefined;
		}) {
			const db = yield* CurrentDb;
			const conditions = [eq(schema.signalSchema.slug, input.schemaSlug)];
			if (input.actorUserId) {
				conditions.push(eq(schema.signal.actorUserId, input.actorUserId));
			}
			if (input.subjectEntityId) {
				conditions.push(eq(schema.signal.subjectEntityId, input.subjectEntityId));
			}
			const rows = yield* dbEffect(() =>
				db
					.select({ signal: schema.signal })
					.from(schema.signal)
					.innerJoin(schema.signalSchema, eq(schema.signalSchema.id, schema.signal.signalSchemaId))
					.where(and(...conditions))
					.orderBy(desc(schema.signal.createdAt)),
			);
			return yield* Effect.forEach(rows, (row) => toStoredSignal(row.signal));
		});

		const isUserEnabled = Effect.fn("SignalsRepository.isUserEnabled")(function* (userId: UserId) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ id: schema.user.id })
					.from(schema.user)
					.where(and(eq(schema.user.id, userId), isNull(schema.user.disabledAt)))
					.limit(1),
			);
			return row !== undefined;
		});

		return {
			insert,
			findById,
			isUserEnabled,
			insertRecipients,
			listBySchemaSlug,
			listRecipientUserIds,
		};
	},
}) {}
