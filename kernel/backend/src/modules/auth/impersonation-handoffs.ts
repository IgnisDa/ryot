import {
	GodModeInternalFailure,
	GodModeNotFound,
	GodModeRequestFailure,
} from "@ryot-app/contract/modules/god-mode/contract";
import {
	buildOAuthAuthorizationUrl,
	getNativeOAuthCallbackUri,
	getWebOAuthCallbackUri,
	IMPERSONATION_HANDOFF_TTL_SECONDS,
	ImpersonationAuthorization,
	OAUTH_IMPERSONATION_WEB_CLIENT_ID,
	OAUTH_NATIVE_APPLICATION_IDS,
} from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Data, Effect, Layer, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { makeOpaqueTickets } from "#lib/infrastructure/opaque-tickets";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";

import { LifecycleWriteGuard } from "./lifecycle-write-guard";
import { AuthRepository } from "./repository";

const Handoff = Schema.Struct({ userId: UserId, authorization: ImpersonationAuthorization });

export class ImpersonationHandoffInvalid extends Data.TaggedError("ImpersonationHandoffInvalid") {}

export class ImpersonationHandoffs extends Context.Service<ImpersonationHandoffs>()(
	"ImpersonationHandoffs",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const redis = yield* RedisService;
			const repository = yield* AuthRepository;
			const lifecycle = yield* LifecycleWriteGuard;
			const tickets = makeOpaqueTickets({
				redis,
				key: redisKeys.impersonationHandoff,
				codec: Schema.fromJsonString(Handoff),
				ttlSeconds: IMPERSONATION_HANDOFF_TTL_SECONDS,
				invalid: () => new ImpersonationHandoffInvalid(),
				unavailable: () =>
					new GodModeInternalFailure({ reason: { code: "impersonation-unavailable" } }),
			});
			const requireTarget = Effect.fn("ImpersonationHandoffs.requireTarget")(function* (
				userId: UserId,
			) {
				const user = yield* repository.findUserById(userId);
				if (!user) {
					return yield* new GodModeNotFound({ reason: { userId, code: "user-not-found" } });
				}
				if (user.disabledAt) {
					return yield* new GodModeRequestFailure({ reason: { code: "user-disabled" } });
				}
				if (!user.bootstrapCompletedAt) {
					return yield* new GodModeRequestFailure({ reason: { code: "user-initializing" } });
				}
				if (yield* lifecycle.isActive(userId)) {
					return yield* new GodModeRequestFailure({ reason: { code: "user-unavailable" } });
				}
				return user;
			});
			const create = Effect.fn("ImpersonationHandoffs.create")(function* (
				userId: UserId,
				authorization: ImpersonationAuthorization,
			) {
				yield* requireTarget(userId);
				const redirects =
					authorization.clientId === OAUTH_IMPERSONATION_WEB_CLIENT_ID
						? [getWebOAuthCallbackUri(config.frontendUrl)]
						: OAUTH_NATIVE_APPLICATION_IDS.map(getNativeOAuthCallbackUri);
				if (
					!redirects.includes(authorization.redirectUri) ||
					!/^[A-Za-z0-9_-]{43}$/.test(authorization.codeChallenge) ||
					![authorization.state, authorization.nonce].every((value) =>
						/^[A-Za-z0-9_-]{16,256}$/.test(value),
					)
				) {
					return yield* new GodModeRequestFailure({
						reason: { code: "invalid-impersonation-authorization" },
					});
				}
				return yield* tickets.create({ userId, authorization });
			});
			const consume = Effect.fn("ImpersonationHandoffs.consume")(function* (ticket: string) {
				const handoff = yield* tickets.consume(ticket);
				yield* requireTarget(handoff.userId);
				return {
					userId: handoff.userId,
					authorizationUrl: buildOAuthAuthorizationUrl(config.frontendUrl, handoff.authorization),
				};
			});
			return { create, consume };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(AuthRepository.layer),
		Layer.provide(LifecycleWriteGuard.layer),
	);
}
