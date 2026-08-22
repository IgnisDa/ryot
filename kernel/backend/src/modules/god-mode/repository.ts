import type { UserId } from "@ryot-app/contract/schema/brands";
import { eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/auth";
import { mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";

export class GodModeRepository extends Context.Service<GodModeRepository>()("GodModeRepository", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const listAccountsForUsers = Effect.fn("GodModeRepository.listAccountsForUsers")(function* (
			userIds: string[],
		) {
			const db = yield* session.current;
			return yield* mapDatabaseErrors(
				db
					.select({ userId: schema.account.userId, providerId: schema.account.providerId })
					.from(schema.account)
					.where(inArray(schema.account.userId, userIds)),
			);
		});

		const findUserById = Effect.fn("GodModeRepository.findUserById")(function* (userId: UserId) {
			const db = yield* session.current;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ id: schema.user.id, email: schema.user.email })
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			return row ?? null;
		});

		const findUserIdByEmail = Effect.fn("GodModeRepository.findUserIdByEmail")(function* (
			email: string,
		) {
			const db = yield* session.current;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ id: schema.user.id })
					.from(schema.user)
					.where(eq(schema.user.email, email))
					.limit(1),
			);
			return row ?? null;
		});

		const findUserDisabledState = Effect.fn("GodModeRepository.findUserDisabledState")(function* (
			userId: UserId,
		) {
			const db = yield* session.current;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ id: schema.user.id, disabledAt: schema.user.disabledAt })
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			return row ?? null;
		});

		return { findUserById, findUserIdByEmail, listAccountsForUsers, findUserDisabledState };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
