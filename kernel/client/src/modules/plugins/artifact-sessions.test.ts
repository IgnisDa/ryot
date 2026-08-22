import { describe, expect, it } from "@effect/vitest";
import type {
	ContractPathParams,
	ContractPayload,
	ContractSuccess,
} from "@ryot-app/contract/client";
import {
	PluginArtifactSessionNotFoundError,
	PluginArtifactSessionUnavailableError,
	PluginConflictError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import type { Layer } from "effect";
import { Cause, Effect, Exit, Fiber } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import type { PluginsApi } from "#/api/plugins";
import { makePluginsApi, unused } from "#/api/ports.test-layer";
import type { ApiScope } from "#/api/scope";
import {
	ArtifactSessionCreationError,
	ArtifactSessions,
	ArtifactSessionTemporaryError,
} from "#/modules/plugins/artifact-sessions";

const serverOrigin = decodeServerOrigin("https://ryot.example");
const scope: ApiScope = { userId: "user-1", serverUrl: serverOrigin };

type CreateRequest = {
	readonly payload: ContractPayload<"plugins", "createArtifactSession">;
	readonly params: ContractPathParams<"plugins", "createArtifactSession">;
};

type SessionRequest = {
	readonly params: ContractPathParams<"plugins", "renewArtifactSession">;
};

type SessionResult<M extends keyof PluginsApi["Service"]> = Effect.Effect<
	ContractSuccess<"plugins", M>,
	AuthenticatedApiError
>;

type PluginsStub = {
	readonly revokeArtifactSession?: (
		request: SessionRequest,
	) => SessionResult<"revokeArtifactSession">;
	readonly renewArtifactSession?: (
		request: SessionRequest,
	) => SessionResult<"renewArtifactSession">;
	readonly createArtifactSession?: (
		request: CreateRequest,
	) => SessionResult<"createArtifactSession">;
};

const fails = (cause: unknown) => () => Effect.fail(new AuthenticatedApiError({ cause }));

const makeApi = (plugins: PluginsStub) =>
	makePluginsApi({
		renewArtifactSession: (_scope, request) => (plugins.renewArtifactSession ?? unused)(request),
		revokeArtifactSession: (_scope, request) => (plugins.revokeArtifactSession ?? unused)(request),
		createArtifactSession: (_scope, request) => (plugins.createArtifactSession ?? unused)(request),
	});

const run = <A, E>(
	effect: Effect.Effect<A, E, ArtifactSessions>,
	dependencies: Layer.Layer<PluginsApi>,
) => effect.pipe(Effect.provide(ArtifactSessions.layer), Effect.provide(dependencies));

describe("artifact sessions", () => {
	it.effect("creates the exact scoped contract request and hides the raw token", () => {
		const calls: CreateRequest[] = [];
		const dependencies = makeApi({
			createArtifactSession: (request) => {
				calls.push(request);
				return Effect.succeed({
					token: "token / value",
					sessionId: "session-1",
					expiresAt: "2026-09-01T00:00:00.000Z",
				});
			},
		});

		return run(
			Effect.gen(function* () {
				const service = yield* ArtifactSessions;
				const created = yield* service.create({
					scope,
					pluginSlug: "fixture",
					sourceHash: "source-hash",
					installationId: "installation-1",
					clientArtifactHash: "artifact-hash",
				});

				expect(calls).toEqual([
					{
						params: { pluginSlug: "fixture", installationId: "installation-1" },
						payload: { sourceHash: "source-hash", artifactHash: "artifact-hash" },
					},
				]);
				expect(created).toEqual({
					sessionId: "session-1",
					expiresAt: "2026-09-01T00:00:00.000Z",
					src: `${serverOrigin}/api/plugin-artifact-sessions/token%20%2F%20value/index.html`,
				});
				expect(created).not.toHaveProperty("token");
			}),
			dependencies,
		);
	});

	const creationFailures = [
		[
			new PluginConflictError({
				reason: { code: "source-revision-stale", pluginSlug: PluginSlug.make("fixture") },
			}),
			"ArtifactSessionStaleError",
		],
		[
			new PluginArtifactSessionNotFoundError({ reason: { code: "artifact-session-not-found" } }),
			"ArtifactSessionCreationError",
		],
		[
			new PluginArtifactSessionUnavailableError({
				reason: { code: "artifact-session-store-unavailable" },
			}),
			"ArtifactSessionTemporaryError",
		],
		[new TypeError("network unavailable"), "ArtifactSessionCreationError"],
	] as const;

	for (const [cause, expectedTag] of creationFailures) {
		it.effect(`classifies create failure as ${expectedTag}`, () =>
			run(
				Effect.gen(function* () {
					const service = yield* ArtifactSessions;
					const error = yield* Effect.flip(
						service.create({
							scope,
							pluginSlug: "fixture",
							sourceHash: "source-hash",
							installationId: "installation-1",
							clientArtifactHash: "artifact-hash",
						}),
					);
					expect(error._tag).toBe(expectedTag);
					expect(error).not.toHaveProperty("cause");
				}),
				makeApi({ createArtifactSession: fails(cause) }),
			),
		);
	}

	it.effect("renews by opaque session id and classifies an expired or missing session", () => {
		const calls: SessionRequest[] = [];
		const dependencies = makeApi({
			renewArtifactSession: (request) => {
				calls.push(request);
				return fails(
					new PluginArtifactSessionNotFoundError({
						reason: { code: "artifact-session-not-found" },
					}),
				)();
			},
		});

		return run(
			Effect.gen(function* () {
				const service = yield* ArtifactSessions;
				expect(yield* service.renew({ scope, sessionId: "session-1" })).toEqual({
					outcome: "replace",
					reason: "not-found",
				});
				expect(calls).toEqual([{ params: { sessionId: "session-1" } }]);
			}),
			dependencies,
		);
	});

	it.effect("maps renewal and revocation transport failures to temporary errors", () => {
		const dependencies = makeApi({
			renewArtifactSession: fails(new TypeError("network unavailable")),
			revokeArtifactSession: fails(new TypeError("network unavailable")),
		});

		return run(
			Effect.gen(function* () {
				const service = yield* ArtifactSessions;
				expect((yield* Effect.flip(service.renew({ scope, sessionId: "session-1" })))._tag).toBe(
					"ArtifactSessionTemporaryError",
				);
				expect((yield* Effect.flip(service.revoke({ scope, sessionId: "session-1" })))._tag).toBe(
					"ArtifactSessionTemporaryError",
				);
			}),
			dependencies,
		);
	});

	it.effect("propagates cancellation without classifying it", () => {
		const dependencies = makeApi({ createArtifactSession: () => Effect.never });

		return run(
			Effect.gen(function* () {
				const service = yield* ArtifactSessions;
				const fiber = yield* Effect.forkChild(
					service.create({
						scope,
						pluginSlug: "fixture",
						sourceHash: "source-hash",
						installationId: "installation-1",
						clientArtifactHash: "artifact-hash",
					}),
				);
				yield* Fiber.interrupt(fiber);
				const exit = yield* Fiber.await(fiber);
				expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
				expect(Exit.isFailure(exit) && String(exit.cause)).not.toContain(
					ArtifactSessionTemporaryError.name,
				);
				expect(Exit.isFailure(exit) && String(exit.cause)).not.toContain(
					ArtifactSessionCreationError.name,
				);
			}),
			dependencies,
		);
	});
});
