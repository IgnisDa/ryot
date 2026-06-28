import {
	ClientPageSessionNotFound,
	ClientPageStalePreparation,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { HttpClientError } from "effect/unstable/http";

import { ClientPagesApi } from "#/api/client-pages";
import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";

export class ClientPageSessionStale extends Data.TaggedError("ClientPageSessionStale") {}
export class ClientPageSessionTemporary extends Data.TaggedError("ClientPageSessionTemporary") {}

const isStale = Schema.is(ClientPageStalePreparation);
const isNotFound = Schema.is(ClientPageSessionNotFound);

type ClientPageSessionRenewal =
	| { readonly outcome: "renewed"; readonly expiresAt: string }
	| { readonly outcome: "replace"; readonly reason: "stale" | "not-found" };

export class ClientPageSessions extends Context.Service<ClientPageSessions>()(
	"ClientPageSessions",
	{
		make: Effect.gen(function* () {
			const api = yield* ClientPagesApi;
			const create = (scope: ApiScope, identity: PreparedClientPage["identity"]) =>
				api.createSession(scope, { payload: { identity } }).pipe(
					Effect.map(({ expiresAt, sessionId, token }) => ({
						expiresAt,
						sessionId,
						src: `${serverApiUrl(scope.serverUrl)}/client-pages/artifacts/${encodeURIComponent(token)}/index.html`,
					})),
					Effect.mapError((error) =>
						isStale(error.cause) ? new ClientPageSessionStale() : new ClientPageSessionTemporary(),
					),
				);
			const renew = (
				scope: ApiScope,
				sessionId: string,
			): Effect.Effect<ClientPageSessionRenewal, ClientPageSessionTemporary> =>
				api.renewSession(scope, { params: { sessionId } }).pipe(
					Effect.map(({ expiresAt }) => ({ outcome: "renewed" as const, expiresAt })),
					Effect.catchTag(
						"AuthenticatedApiError",
						(
							error,
						): Effect.Effect<
							{ readonly outcome: "replace"; readonly reason: "stale" | "not-found" },
							ClientPageSessionTemporary
						> => {
							if (isStale(error.cause)) {
								return Effect.succeed({ outcome: "replace", reason: "stale" });
							}
							if (isNotFound(error.cause)) {
								return Effect.succeed({ outcome: "replace", reason: "not-found" });
							}
							return Effect.fail(new ClientPageSessionTemporary());
						},
					),
				);
			const revoke = (scope: ApiScope, sessionId: string) =>
				api
					.revokeSession(scope, { params: { sessionId } })
					.pipe(
						Effect.catchTag("AuthenticatedApiError", (error) =>
							isNotFound(error.cause) || HttpClientError.isHttpClientError(error.cause)
								? Effect.void
								: Effect.fail(new ClientPageSessionTemporary()),
						),
					);
			return { create, renew, revoke };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
