import { asc, eq, lte } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { uploadIntent as table } from "#schema/tables/uploads";

const dateFromSeconds = (seconds: number) => new Date(seconds * 1000);

export class UploadIntentsRepository extends Context.Service<UploadIntentsRepository>()(
	"@ryot-app/kernel-backend/modules/assets/uploads/intents-repository/UploadIntentsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			return {
				remove: (id: string) =>
					session
						.run((db) => db.delete(table).where(eq(table.id, id)))
						.pipe(Effect.asVoid, Effect.orDie),
				get: (id: string) =>
					session
						.run((db) =>
							db.select({ metadata: table.metadata }).from(table).where(eq(table.id, id)),
						)
						.pipe(
							Effect.map(([row]) => row?.metadata ?? null),
							Effect.orDie,
						),
				setDeadline: (id: string, deadlineSeconds: number) =>
					session
						.run((db) =>
							db
								.update(table)
								.set({ deadline: dateFromSeconds(deadlineSeconds) })
								.where(eq(table.id, id)),
						)
						.pipe(Effect.asVoid, Effect.orDie),
				due: (nowSeconds: number, limit: number) =>
					session
						.run((db) =>
							db
								.select({ id: table.id })
								.from(table)
								.where(lte(table.deadline, dateFromSeconds(nowSeconds)))
								.orderBy(asc(table.deadline))
								.limit(limit),
						)
						.pipe(
							Effect.map((rows) => rows.map(({ id }) => id)),
							Effect.orDie,
						),
				put: (id: string, metadata: string, deadlineSeconds: number) => {
					const deadline = dateFromSeconds(deadlineSeconds);
					return session
						.run((db) =>
							db
								.insert(table)
								.values({ id, metadata, deadline })
								.onConflictDoUpdate({ target: table.id, set: { metadata, deadline } }),
						)
						.pipe(Effect.asVoid, Effect.orDie);
				},
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
