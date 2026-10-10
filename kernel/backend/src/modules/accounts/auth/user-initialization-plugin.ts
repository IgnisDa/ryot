import type { BetterAuthPlugin, Session, User } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";

type InitializationUser = User & { readonly bootstrapCompletedAt?: Date | null };

export const userInitializationPlugin = (): BetterAuthPlugin => ({
	id: "user-initialization",
	endpoints: {
		initializationStatus: createAuthEndpoint(
			"/initialization-status",
			{ method: "GET" },
			// oxlint-disable-next-line effecttsgo/async-function -- Better Auth endpoint handlers are Promise-native.
			async (ctx) => {
				const current = await getSessionFromCtx<InitializationUser, Session>(ctx, {
					disableRefresh: true,
					disableCookieCache: true,
				});
				if (!current) {
					throw APIError.from("UNAUTHORIZED", {
						code: "AUTHENTICATION_REQUIRED",
						message: "Authentication is required.",
					});
				}
				const user: InitializationUser | null = await ctx.context.internalAdapter.findUserById(
					current.user.id,
				);
				const status = user?.bootstrapCompletedAt ? "ready" : "initializing";
				return ctx.json({ status });
			},
		),
	},
});
