import type { OAuthProviderExtension } from "@better-auth/oauth-provider";
import { OAUTH_IMPERSONATION_CLIENT_IDS } from "@ryot-app/contract/oauth";
import { APIError } from "better-auth/api";
import { Effect, Option, Schema } from "effect";

import type { ImpersonationSessions } from "./impersonation-sessions";

const TokenSession = Schema.Struct({ sid: Schema.String, sub: Schema.String, azp: Schema.String });

export const isImpersonationClient = (clientId: string) =>
	OAUTH_IMPERSONATION_CLIENT_IDS.some((id) => id === clientId);

export const impersonationOAuthExtension = (
	sessions: ImpersonationSessions["Service"],
): OAuthProviderExtension => ({
	claims: {
		accessToken: ({ user, client, sessionId }) =>
			Effect.runPromise(
				Effect.gen(function* () {
					if (!isImpersonationClient(client.clientId)) {
						return {};
					}
					const active = sessionId && user ? yield* sessions.getActive(sessionId, user.id) : null;
					if (!active) {
						return yield* Effect.fail(
							new APIError("BAD_REQUEST", {
								error: "invalid_grant",
								error_description: "The impersonation session has ended.",
							}),
						);
					}
					return { impersonation: active };
				}),
			),
		userInfo: ({ jwt }) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const token = Schema.decodeUnknownOption(TokenSession)(jwt);
					if (Option.isNone(token) || !isImpersonationClient(token.value.azp)) {
						return {};
					}
					const active = yield* sessions.getActive(token.value.sid, token.value.sub);
					if (!active) {
						return yield* Effect.fail(
							new APIError("UNAUTHORIZED", {
								error: "invalid_token",
								error_description: "The impersonation session has ended.",
							}),
						);
					}
					return { impersonation: active };
				}),
			),
	},
});
