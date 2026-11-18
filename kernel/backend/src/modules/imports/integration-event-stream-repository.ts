import { DbError } from "@ryot-app/contract/errors";
import { EntityId, EventSchemaSlug, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { integration, integrationEventStream as table } from "#schema/tables/imports";

export const IntegrationEventStreamKey = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	integrationId: IntegrationId,
	eventSchemaSlug: EventSchemaSlug,
});
export type IntegrationEventStreamKey = typeof IntegrationEventStreamKey.Type;

const identity = ({ entityId, integrationId, eventSchemaSlug }: IntegrationEventStreamKey) => ({
	entityId,
	integrationId,
	eventSchemaSlug,
});
const predicate = (key: IntegrationEventStreamKey) =>
	and(
		eq(table.integrationId, key.integrationId),
		eq(table.entityId, key.entityId),
		eq(table.eventSchemaSlug, key.eventSchemaSlug),
	);

export class IntegrationEventStreamRepository extends Context.Service<IntegrationEventStreamRepository>()(
	"@ryot-app/kernel-backend/modules/imports/integration-event-stream-repository/IntegrationEventStreamRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const lock = Effect.fnUntraced(function* (key: IntegrationEventStreamKey) {
				yield* session.requireTransaction.pipe(
					Effect.mapError(() => new DbError({ message: "Event streams require a transaction" })),
				);
				const [configuration] = yield* session.run((db) =>
					db
						.select({
							disabledAt: user.disabledAt,
							retiring: integration.retiring,
							disabled: integration.isDisabled,
						})
						.from(integration)
						.innerJoin(user, eq(user.id, integration.userId))
						.where(and(eq(integration.id, key.integrationId), eq(integration.userId, key.userId)))
						.for("share", { of: integration }),
				);
				if (
					!configuration ||
					configuration.disabled ||
					configuration.retiring ||
					configuration.disabledAt !== null
				) {
					return false;
				}
				const scope = stableStringify(["integration-event-stream", identity(key)]);
				yield* session.run((db) =>
					db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`),
				);
				return true;
			});
			const read = Effect.fnUntraced(function* (key: IntegrationEventStreamKey) {
				const [row] = yield* session.run((db) =>
					db
						.select({
							pending: table.pending,
							observedAt: table.observedAt,
							eligibleAt: table.eligibleAt,
							fingerprint: table.fingerprint,
						})
						.from(table)
						.where(predicate(key)),
				);
				return row ?? null;
			});
			const write = (
				key: IntegrationEventStreamKey,
				state: Pick<
					typeof table.$inferInsert,
					"pending" | "observedAt" | "eligibleAt" | "fingerprint"
				>,
			) =>
				session
					.run((db) =>
						db
							.insert(table)
							.values({ ...identity(key), ...state })
							.onConflictDoUpdate({
								set: state,
								target: [table.integrationId, table.entityId, table.eventSchemaSlug],
							}),
					)
					.pipe(Effect.asVoid);
			return { lock, read, write };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
