import type { UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { assistantProvider } from "#schema/tables/assistant";

export class AssistantProviderRepository extends Context.Service<AssistantProviderRepository>()(
	"@ryot-app/kernel-backend/modules/assistant/provider-repository/AssistantProviderRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			return {
				remove: Effect.fn(function* (userId: UserId) {
					yield* session.requireTransaction;
					yield* session.run((db) =>
						db.delete(assistantProvider).where(eq(assistantProvider.userId, userId)),
					);
				}),
				find: Effect.fn(function* (userId: UserId) {
					const [row] = yield* session.run((db) =>
						db.select().from(assistantProvider).where(eq(assistantProvider.userId, userId)),
					);
					return row ?? null;
				}),
				put: Effect.fn(function* (
					userId: UserId,
					input: Pick<
						typeof assistantProvider.$inferInsert,
						"model" | "baseUrl" | "contextWindow" | "encryptedApiKey" | "maxOutputTokens"
					>,
				) {
					yield* session.requireTransaction;
					yield* session.run((db) =>
						db
							.insert(assistantProvider)
							.values({ ...input, userId })
							.onConflictDoUpdate({
								target: assistantProvider.userId,
								set: { ...input, updatedAt: new Date() },
							}),
					);
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
