import {
	PluginArtifactSessionNotFoundError,
	PluginArtifactSessionUnavailableError,
	PluginConflictError,
} from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { HttpClientError } from "effect/unstable/http";

import { AuthenticatedApi } from "#/api/authenticated";
import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";

export class ArtifactSessionStaleError extends Data.TaggedError("ArtifactSessionStaleError") {}

export class ArtifactSessionTemporaryError extends Data.TaggedError(
	"ArtifactSessionTemporaryError",
) {}

export class ArtifactSessionCreationError extends Data.TaggedError(
	"ArtifactSessionCreationError",
) {}

const isConflict = Schema.is(PluginConflictError);
const isNotFound = Schema.is(PluginArtifactSessionNotFoundError);
const isUnavailable = Schema.is(PluginArtifactSessionUnavailableError);

export type ArtifactSession = {
	readonly src: string;
	readonly expiresAt: string;
	readonly sessionId: string;
};

export class ArtifactSessions extends Context.Service<ArtifactSessions>()("ArtifactSessions", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;

		const create = Effect.fn("ArtifactSessions.create")(function* (input: {
			readonly scope: ApiScope;
			readonly pluginSlug: string;
			readonly sourceHash: string;
			readonly installationId: string;
			readonly clientArtifactHash: string;
		}) {
			return yield* api
				.run(input.scope, (client) =>
					client.plugins.createArtifactSession({
						payload: { sourceHash: input.sourceHash, artifactHash: input.clientArtifactHash },
						params: {
							installationId: input.installationId,
							pluginSlug: PluginSlug.make(input.pluginSlug),
						},
					}),
				)
				.pipe(
					Effect.map(({ expiresAt, sessionId, token }) => ({
						expiresAt,
						sessionId,
						src: `${serverApiUrl(input.scope.serverUrl)}/plugin-artifact-sessions/${encodeURIComponent(token)}/index.html`,
					})),
					Effect.mapError((error) => {
						if (isConflict(error.cause) && error.cause.reason.code === "source-revision-stale") {
							return new ArtifactSessionStaleError();
						}
						if (isUnavailable(error.cause) || HttpClientError.isHttpClientError(error.cause)) {
							return new ArtifactSessionTemporaryError();
						}
						return new ArtifactSessionCreationError();
					}),
				);
		});

		const renew = Effect.fn("ArtifactSessions.renew")(function* (input: {
			readonly scope: ApiScope;
			readonly sessionId: string;
		}) {
			return yield* api
				.run(input.scope, (client) =>
					client.plugins.renewArtifactSession({
						params: { sessionId: input.sessionId },
					}),
				)
				.pipe(
					Effect.map(({ expiresAt }) => ({ expiresAt, outcome: "renewed" }) as const),
					Effect.catchTag("AuthenticatedApiError", (error) =>
						isNotFound(error.cause)
							? Effect.succeed({ outcome: "replace", reason: "not-found" } as const)
							: Effect.fail(new ArtifactSessionTemporaryError()),
					),
				);
		});

		const revoke = Effect.fn("ArtifactSessions.revoke")(function* (input: {
			readonly scope: ApiScope;
			readonly sessionId: string;
		}) {
			return yield* api
				.run(input.scope, (client) =>
					client.plugins.revokeArtifactSession({ params: { sessionId: input.sessionId } }),
				)
				.pipe(
					Effect.catchTag("AuthenticatedApiError", (error) =>
						isNotFound(error.cause)
							? Effect.void
							: Effect.fail(new ArtifactSessionTemporaryError()),
					),
				);
		});

		return { create, renew, revoke };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
