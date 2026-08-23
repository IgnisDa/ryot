import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/contract/modules/plugins/client";
import {
	PluginConflictError,
	PluginArtifactSessionNotFoundError,
	PluginArtifactSessionUnavailableError,
	PluginNotFoundError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect";

import {
	hashPluginClientArtifactSessionToken,
	PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS,
	PluginClientArtifactSessionPayloadFromJson,
	RedisService,
	redisKeys,
} from "#lib/infrastructure/redis";

import { PluginRepository } from "./repository";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;
const STORE_ATTEMPTS = 3;

const decodePayload = Schema.decodeUnknownEffect(PluginClientArtifactSessionPayloadFromJson, {
	onExcessProperty: "error",
});
const encodePayload = Schema.encodeUnknownEffect(PluginClientArtifactSessionPayloadFromJson, {
	onExcessProperty: "error",
});

const notFound = () =>
	new PluginArtifactSessionNotFoundError({
		reason: { code: "artifact-session-not-found" },
	});
const storeUnavailable = () =>
	new PluginArtifactSessionUnavailableError({
		reason: { code: "artifact-session-store-unavailable" },
	});
const makeToken = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export class PluginClientArtifactSessionService extends Context.Service<PluginClientArtifactSessionService>()(
	"PluginClientArtifactSessionService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const repository = yield* PluginRepository;

			const remove = (sessionId: string, value: string) =>
				redis
					.releaseLease(redisKeys.pluginClientArtifactSession(sessionId), value)
					.pipe(Effect.ignoreCause);

			const load = Effect.fn("PluginClientArtifactSessionService.load")(function* (
				sessionId: string,
			) {
				if (!SESSION_ID_PATTERN.test(sessionId)) {
					return yield* notFound();
				}
				const raw = yield* Effect.tryPromise({
					catch: storeUnavailable,
					try: () => redis.client.get(redisKeys.pluginClientArtifactSession(sessionId)),
				});
				if (raw === null) {
					return yield* notFound();
				}
				const payload = yield* decodePayload(raw).pipe(
					Effect.tapError(() => remove(sessionId, raw)),
					Effect.mapError(notFound),
				);
				return { payload, raw };
			});

			const create = Effect.fn("PluginClientArtifactSessionService.create")(function* (input: {
				readonly userId: UserId;
				readonly pluginSlug: PluginSlug;
				readonly sourceHash: string;
				readonly artifactHash: string;
				readonly installationId: string;
			}) {
				const artifact = yield* repository.findPrivateClientArtifact(input);
				if (!artifact) {
					return yield* new PluginNotFoundError({
						reason: { code: "plugin-not-found", pluginSlug: input.pluginSlug },
					});
				}
				if (artifact.health !== "ready" && artifact.health !== "needs-configuration") {
					return yield* new PluginConflictError({
						reason: {
							health: artifact.health,
							pluginSlug: input.pluginSlug,
							code: "installation-not-ready",
						},
					});
				}
				if (
					artifact.artifactFormat !== CLIENT_ARTIFACT_FORMAT ||
					artifact.clientApiVersion !== CLIENT_API_VERSION ||
					artifact.bridgeVersion !== CLIENT_BRIDGE_PROTOCOL_VERSION ||
					artifact.compilerVersion !== CLIENT_COMPILER_VERSION
				) {
					return yield* new PluginConflictError({
						reason: {
							health: "incompatible",
							pluginSlug: input.pluginSlug,
							code: "installation-not-ready",
						},
					});
				}
				if (
					artifact.sourceHash !== input.sourceHash ||
					artifact.artifactHash !== input.artifactHash
				) {
					return yield* new PluginConflictError({
						reason: { code: "source-revision-stale", pluginSlug: input.pluginSlug },
					});
				}
				const value = yield* encodePayload({
					userId: input.userId,
					pluginId: artifact.pluginId,
					pluginSlug: artifact.pluginSlug,
					sourceHash: artifact.sourceHash,
					artifactHash: artifact.artifactHash,
					installationId: input.installationId,
				}).pipe(Effect.orDie);
				for (let attempt = 0; attempt < STORE_ATTEMPTS; attempt++) {
					const token = makeToken();
					const sessionId = hashPluginClientArtifactSessionToken(token);
					const stored = yield* Effect.tryPromise({
						catch: storeUnavailable,
						try: () =>
							redis.client.set(
								redisKeys.pluginClientArtifactSession(sessionId),
								value,
								"EX",
								PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS,
								"NX",
							),
					});
					if (stored !== null) {
						const now = yield* Clock.currentTimeMillis;
						return {
							token,
							sessionId,
							expiresAt: DateTime.formatIso(
								DateTime.makeUnsafe(now + PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS * 1_000),
							),
						};
					}
				}
				return yield* storeUnavailable();
			});

			const renew = Effect.fn("PluginClientArtifactSessionService.renew")(function* (input: {
				readonly userId: UserId;
				readonly sessionId: string;
			}) {
				const { payload, raw } = yield* load(input.sessionId);
				if (payload.userId !== input.userId) {
					return yield* notFound();
				}
				const artifact = yield* repository.findPrivateClientArtifact(payload);
				if (
					!artifact ||
					(artifact.health !== "ready" && artifact.health !== "needs-configuration") ||
					artifact.sourceHash !== payload.sourceHash ||
					artifact.artifactHash !== payload.artifactHash ||
					artifact.artifactFormat !== CLIENT_ARTIFACT_FORMAT ||
					artifact.clientApiVersion !== CLIENT_API_VERSION ||
					artifact.bridgeVersion !== CLIENT_BRIDGE_PROTOCOL_VERSION ||
					artifact.compilerVersion !== CLIENT_COMPILER_VERSION
				) {
					yield* remove(input.sessionId, raw);
					return yield* notFound();
				}
				const renewed = yield* redis
					.renewLease(
						redisKeys.pluginClientArtifactSession(input.sessionId),
						raw,
						PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS,
					)
					.pipe(Effect.catchCause(() => Effect.fail(storeUnavailable())));
				if (!renewed) {
					return yield* notFound();
				}
				const now = yield* Clock.currentTimeMillis;
				return {
					expiresAt: DateTime.formatIso(
						DateTime.makeUnsafe(now + PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS * 1_000),
					),
				};
			});

			const revoke = Effect.fn("PluginClientArtifactSessionService.revoke")(function* (input: {
				readonly userId: UserId;
				readonly sessionId: string;
			}) {
				const loaded = yield* load(input.sessionId).pipe(
					Effect.catchTag("PluginArtifactSessionNotFoundError", () => Effect.succeed(null)),
				);
				if (!loaded || loaded.payload.userId !== input.userId) {
					return;
				}
				yield* redis
					.releaseLease(redisKeys.pluginClientArtifactSession(input.sessionId), loaded.raw)
					.pipe(Effect.catchCause(() => Effect.fail(storeUnavailable())));
			});

			const findFile = Effect.fn("PluginClientArtifactSessionService.findFile")(function* (
				token: string,
				fileName: string,
			) {
				if (!TOKEN_PATTERN.test(token)) {
					return yield* notFound();
				}
				const sessionId = hashPluginClientArtifactSessionToken(token);
				const { payload } = yield* load(sessionId);
				const file = yield* repository.findPrivateClientArtifactFile({ ...payload, fileName });
				if (!file) {
					return yield* notFound();
				}
				return file;
			});

			return { create, renew, revoke, findFile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
