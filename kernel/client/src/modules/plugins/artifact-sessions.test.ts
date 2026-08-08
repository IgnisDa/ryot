import { describe, expect, it } from "@effect/vitest";
import type { ContractClient, ContractPathParams, ContractPayload } from "@ryot/contract/client";
import {
	PluginArtifactSessionNotFoundError,
	PluginArtifactSessionUnavailableError,
	PluginConflictError,
} from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";
import {
	ArtifactSessionCreationError,
	ArtifactSessions,
	ArtifactSessionTemporaryError,
} from "#/modules/plugins/artifact-sessions";

const scope: ApiScope = { userId: "user-1", serverUrl: "https://ryot.example/" };

type CreateRequest = {
	readonly payload: ContractPayload<"plugins", "createArtifactSession">;
	readonly params: ContractPathParams<"plugins", "createArtifactSession">;
};

type SessionRequest = {
	readonly params: ContractPathParams<"plugins", "renewArtifactSession">;
};

type PluginsStub = {
	readonly createArtifactSession?: (request: CreateRequest) => Effect.Effect<unknown, unknown>;
	readonly renewArtifactSession?: (request: SessionRequest) => Effect.Effect<unknown, unknown>;
	readonly revokeArtifactSession?: (request: SessionRequest) => Effect.Effect<unknown, unknown>;
};

const makeApi = (plugins: PluginsStub) => {
	// Contract programs receive the complete client even when a service uses one endpoint.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const client = { plugins } as ContractClient;
	return Layer.succeed(AuthenticatedApi, {
		run: <A, E>(_scope: ApiScope, program: (client: ContractClient) => Effect.Effect<A, E>) =>
			program(client).pipe(
				Effect.catch((cause) => Effect.fail(new AuthenticatedApiError({ cause }))),
			),
	});
};

const run = <A, E>(
	effect: Effect.Effect<A, E, ArtifactSessions>,
	dependencies: Layer.Layer<AuthenticatedApi>,
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
					src: "https://ryot.example/api/plugin-artifact-sessions/token%20%2F%20value/index.html",
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
				makeApi({ createArtifactSession: () => Effect.fail(cause) }),
			),
		);
	}

	it.effect("renews by opaque session id and classifies an expired or missing session", () => {
		const calls: SessionRequest[] = [];
		const dependencies = makeApi({
			renewArtifactSession: (request) => {
				calls.push(request);
				return Effect.fail(
					new PluginArtifactSessionNotFoundError({
						reason: { code: "artifact-session-not-found" },
					}),
				);
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
			renewArtifactSession: () => Effect.fail(new TypeError("network unavailable")),
			revokeArtifactSession: () => Effect.fail(new TypeError("network unavailable")),
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
