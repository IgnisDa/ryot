import type { UserId } from "@ryot/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export type PortableUserProfile = Pick<
	typeof schema.user.$inferSelect,
	"image" | "name" | "preferences"
>;

export class AuthRepository extends Context.Service<AuthRepository>()("AuthRepository", {
	make: Effect.sync(() => {
		const getPortableProfile = Effect.fn("AuthRepository.getPortableProfile")(function* (
			userId: UserId,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({
						name: schema.user.name,
						image: schema.user.image,
						preferences: schema.user.preferences,
					})
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			return row ?? null;
		});

		const restorePortableProfile = Effect.fn("AuthRepository.restorePortableProfile")(function* (
			userId: UserId,
			profile: PortableUserProfile,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.update(schema.user)
					.set(profile)
					.where(eq(schema.user.id, userId))
					.returning({ id: schema.user.id }),
			);
			return row !== undefined;
		});

		return { getPortableProfile, restorePortableProfile };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
