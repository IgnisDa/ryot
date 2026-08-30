import {
	ClientPageSessionNotFound,
	ClientPageStalePreparation,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect";

import {
	ClientPageSessionPayloadFromJson,
	hashPluginClientArtifactSessionToken,
	PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS,
	RedisService,
	redisKeys,
} from "#lib/infrastructure/redis";

import { ClientPagesRepository } from "./repository";
import { ClientPagesService } from "./service";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;
const notFound = () =>
	new ClientPageSessionNotFound({ reason: { code: "page-session-not-found" } });
const stale = () => new ClientPageStalePreparation({ reason: { code: "stale-preparation" } });
const makeToken = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const expiresAt = (now: number) =>
	DateTime.formatIso(DateTime.makeUnsafe(now + PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS * 1_000));

export class ClientPageSessionService extends Context.Service<ClientPageSessionService>()(
	"ClientPageSessionService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const pages = yield* ClientPagesService;
			const repository = yield* ClientPagesRepository;
			const load = Effect.fn(function* (sessionId: string) {
				if (!SESSION_ID_PATTERN.test(sessionId)) {
					return yield* notFound();
				}
				const raw = yield* Effect.tryPromise(() =>
					redis.client.get(redisKeys.clientPageSession(sessionId)),
				).pipe(Effect.mapError(notFound));
				if (raw === null) {
					return yield* notFound();
				}
				const payload = yield* Schema.decodeUnknownEffect(ClientPageSessionPayloadFromJson)(
					raw,
				).pipe(Effect.mapError(notFound));
				return { raw, payload };
			});
			const current = Effect.fn(function* (
				userId: UserId,
				identity: PreparedClientPage["identity"],
			) {
				const isCurrent = yield* pages
					.isIdentityCurrent(userId, identity)
					.pipe(Effect.mapError(stale));
				if (!isCurrent) {
					return yield* stale();
				}
				return yield* Effect.void;
			});

			const create = Effect.fn(function* (
				userId: UserId,
				identity: PreparedClientPage["identity"],
			) {
				yield* current(userId, identity);
				const token = makeToken();
				const sessionId = hashPluginClientArtifactSessionToken(token);
				const value = yield* Schema.encodeUnknownEffect(ClientPageSessionPayloadFromJson)({
					userId,
					identity,
				}).pipe(Effect.orDie);
				const stored = yield* Effect.tryPromise(() =>
					redis.client.set(
						redisKeys.clientPageSession(sessionId),
						value,
						"EX",
						PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS,
						"NX",
					),
				).pipe(Effect.mapError(stale));
				if (stored === null) {
					return yield* stale();
				}
				yield* current(userId, identity).pipe(
					Effect.tapError(() =>
						redis
							.releaseLease(redisKeys.clientPageSession(sessionId), value)
							.pipe(Effect.ignoreCause),
					),
				);
				return { token, sessionId, expiresAt: expiresAt(yield* Clock.currentTimeMillis) };
			});

			const renew = Effect.fn(function* (userId: UserId, sessionId: string) {
				const loaded = yield* load(sessionId);
				if (loaded.payload.userId !== userId) {
					return yield* notFound();
				}
				yield* current(userId, loaded.payload.identity);
				const renewed = yield* redis.renewLease(
					redisKeys.clientPageSession(sessionId),
					loaded.raw,
					PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS,
				);
				if (!renewed) {
					return yield* notFound();
				}
				return { expiresAt: expiresAt(yield* Clock.currentTimeMillis) };
			});

			const revoke = Effect.fn(function* (userId: UserId, sessionId: string) {
				const loaded = yield* load(sessionId).pipe(
					Effect.catchTag("ClientPageSessionNotFound", () => Effect.succeed(null)),
				);
				if (!loaded || loaded.payload.userId !== userId) {
					return;
				}
				yield* redis.releaseLease(redisKeys.clientPageSession(sessionId), loaded.raw);
			});

			const findFile = Effect.fn(function* (token: string, fileName: string) {
				if (!TOKEN_PATTERN.test(token)) {
					return yield* notFound();
				}
				const sessionId = hashPluginClientArtifactSessionToken(token);
				const loaded = yield* load(sessionId);
				yield* current(loaded.payload.userId, loaded.payload.identity).pipe(
					Effect.mapError(notFound),
				);
				return (
					(yield* repository.findArtifactFile(loaded.payload.identity.artifactHash, fileName)) ??
					(yield* notFound())
				);
			});

			return { create, renew, revoke, findFile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
