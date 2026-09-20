import type { UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/auth";
import { DatabaseSession } from "#lib/infrastructure/db/session";

export class UserSettingsRepository extends Context.Service<UserSettingsRepository>()(
	"UserSettingsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const findTwoFactorState = Effect.fn("UserSettingsRepository.findTwoFactorState")(function* (
				userId: UserId,
			) {
				const [user] = yield* session.run((db) =>
					db
						.select({ twoFactorEnabled: schema.user.twoFactorEnabled })
						.from(schema.user)
						.where(eq(schema.user.id, userId))
						.limit(1),
				);
				const accounts = yield* session.run((db) =>
					db
						.select({ providerId: schema.account.providerId })
						.from(schema.account)
						.where(eq(schema.account.userId, userId)),
				);
				return { accounts, twoFactorEnabled: user?.twoFactorEnabled ?? null };
			});

			return { findTwoFactorState };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
