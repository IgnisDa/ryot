import { IMPERSONATION_SESSION_TTL_SECONDS } from "@ryot-app/contract/oauth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { Clock, DateTime, Effect, Schema } from "effect";

import type { ImpersonationHandoffs } from "./impersonation-handoffs";

const RedeemBody = Schema.Struct({ ticket: Schema.String });

export const impersonationPlugin = (
	handoffs: ImpersonationHandoffs["Service"],
): BetterAuthPlugin => ({
	id: "impersonation",
	endpoints: {
		redeemImpersonation: createAuthEndpoint(
			"/impersonation/redeem",
			{ method: "POST" },
			// oxlint-disable-next-line effecttsgo/async-function -- Better Auth endpoint handlers are Promise-native.
			async (ctx) => {
				const result = await Effect.runPromise(
					Effect.gen(function* () {
						const { ticket } = yield* Schema.decodeUnknownEffect(RedeemBody)(ctx.body);
						const handoff = yield* handoffs.consume(ticket);
						const user = yield* Effect.promise(() =>
							ctx.context.internalAdapter.findUserById(handoff.userId),
						);
						if (!user) {
							return yield* Effect.fail(
								APIError.from("FORBIDDEN", {
									code: "USER_UNAVAILABLE",
									message: "The user is unavailable.",
								}),
							);
						}
						const expiresAt = DateTime.toDate(
							DateTime.makeUnsafe(
								(yield* Clock.currentTimeMillis) + IMPERSONATION_SESSION_TTL_SECONDS * 1000,
							),
						);
						const session = yield* Effect.promise(() =>
							ctx.context.internalAdapter.createSession(
								user.id,
								false,
								{ expiresAt, accessClass: "standard", impersonationExpiresAt: expiresAt },
								true,
							),
						);
						yield* Effect.promise(() => setSessionCookie(ctx, { user, session }));
						return { authorizationUrl: handoff.authorizationUrl };
					}).pipe(
						Effect.catchTags({
							GodModeNotFound: () =>
								Effect.fail(
									APIError.from("FORBIDDEN", {
										code: "USER_UNAVAILABLE",
										message: "The user is unavailable.",
									}),
								),
							SchemaError: () =>
								Effect.fail(
									APIError.from("BAD_REQUEST", {
										code: "INVALID_REQUEST",
										message: "Invalid impersonation request.",
									}),
								),
							GodModeRequestFailure: () =>
								Effect.fail(
									APIError.from("FORBIDDEN", {
										code: "USER_UNAVAILABLE",
										message: "The user is unavailable.",
									}),
								),
							GodModeInternalFailure: () =>
								Effect.fail(
									APIError.from("SERVICE_UNAVAILABLE", {
										code: "IMPERSONATION_UNAVAILABLE",
										message: "Impersonation is unavailable.",
									}),
								),
							ImpersonationHandoffInvalid: () =>
								Effect.fail(
									APIError.from("BAD_REQUEST", {
										code: "INVALID_HANDOFF",
										message: "The impersonation handoff has expired or already been used.",
									}),
								),
						}),
					),
				);
				return ctx.json(result);
			},
		),
	},
});
