import { ClientPageArtifactGrantNotFound } from "@ryot-app/contract/modules/client-pages/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect";

import {
	CLIENT_PAGE_ARTIFACT_GRANT_TTL_SECONDS,
	ClientPageArtifactGrantPayloadFromJson,
	hashClientPageArtifactGrantToken,
	RedisService,
	redisKeys,
} from "#lib/infrastructure/redis";

import { ClientPagesRepository } from "./repository";

const notFound = () =>
	new ClientPageArtifactGrantNotFound({ reason: { code: "artifact-grant-not-found" } });
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class ClientPageArtifactGrantService extends Context.Service<ClientPageArtifactGrantService>()(
	"ClientPageArtifactGrantService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const repository = yield* ClientPagesRepository;
			const issue = Effect.fn(function* (userId: UserId, artifactHash: string) {
				const key = redisKeys.clientPageArtifactGrantForUser(userId, artifactHash);
				let token = yield* redis.get(key);
				if (
					token &&
					!(yield* redis.get(
						redisKeys.clientPageArtifactGrant(hashClientPageArtifactGrantToken(token)),
					))
				) {
					yield* redis.releaseLease(key, token);
					token = null;
				}
				if (!token) {
					const fresh = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
						"base64url",
					);
					const grantId = hashClientPageArtifactGrantToken(fresh);
					const payload = yield* Schema.encodeUnknownEffect(ClientPageArtifactGrantPayloadFromJson)(
						{ userId, artifactHash },
					).pipe(Effect.orDie);
					yield* redis.set(
						redisKeys.clientPageArtifactGrant(grantId),
						payload,
						CLIENT_PAGE_ARTIFACT_GRANT_TTL_SECONDS,
					);
					const stored = yield* Effect.tryPromise(() =>
						redis.client.set(key, fresh, "EX", CLIENT_PAGE_ARTIFACT_GRANT_TTL_SECONDS, "NX"),
					).pipe(Effect.orDie);
					token = stored ? fresh : ((yield* redis.get(key)) ?? fresh);
				}
				const grantId = hashClientPageArtifactGrantToken(token);
				const ttl = yield* Effect.tryPromise(() =>
					redis.client.ttl(redisKeys.clientPageArtifactGrant(grantId)),
				).pipe(Effect.orDie);
				const now = yield* Clock.currentTimeMillis;
				return {
					grantId,
					src: `/api/client-pages/artifacts/${token}/index.html`,
					expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + Math.max(0, ttl) * 1000)),
				};
			});
			const findFile = Effect.fn(function* (token: string, fileName: string) {
				if (!TOKEN_PATTERN.test(token)) {
					return yield* notFound();
				}
				const raw = yield* redis.get(
					redisKeys.clientPageArtifactGrant(hashClientPageArtifactGrantToken(token)),
				);
				if (!raw) {
					return yield* notFound();
				}
				const payload = yield* Schema.decodeEffect(ClientPageArtifactGrantPayloadFromJson)(
					raw,
				).pipe(Effect.mapError(notFound));
				return (
					(yield* repository.findArtifactFile(payload.artifactHash, fileName)) ??
					(yield* notFound())
				);
			});
			return { issue, findFile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
