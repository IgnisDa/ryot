import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import * as schema from "#lib/infrastructure/db/schema/tables/auth";
import type { DbRoot } from "#lib/infrastructure/db/service";

export type SessionGateDeps = {
	readonly db: DbRoot;
	readonly runBootstrap: (userId: string) => Promise<void>;
};

export const gateSessionCreation = (deps: SessionGateDeps, userId: string): Promise<void> =>
	deps.db
		.select({
			disabledAt: schema.user.disabledAt,
			bootstrapCompletedAt: schema.user.bootstrapCompletedAt,
		})
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.limit(1)
		.then(([foundUser]) => {
			if (foundUser?.disabledAt) {
				throw APIError.from("FORBIDDEN", {
					code: "USER_DISABLED",
					message: "This user has been disabled.",
				});
			}
			if (foundUser && !foundUser.bootstrapCompletedAt) {
				return deps.runBootstrap(userId).catch(() => {
					throw APIError.from("SERVICE_UNAVAILABLE", {
						code: "USER_INITIALIZING",
						message: "Account initialization in progress. Please sign in again.",
					});
				});
			}
			return undefined;
		});
