import { assert, expect, layer } from "@effect/vitest";
import {
	GodModeNotFound,
	GodModeRequestFailure,
} from "@ryot-app/contract/modules/god-mode/contract";
import {
	getNativeOAuthCallbackUri,
	IMPERSONATION_HANDOFF_TTL_SECONDS,
	OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
	OAUTH_IMPERSONATION_WEB_CLIENT_ID,
} from "@ryot-app/contract/oauth";
import type { ImpersonationAuthorization } from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Clock, Context, Effect, Exit, Layer, Option, Ref } from "effect";
import Redis from "ioredis";

import { RedisService } from "#lib/infrastructure/redis";
import { makeAppConfigLayer, makeRedisService } from "#lib/test-utils/effect";

import { ImpersonationHandoffInvalid, ImpersonationHandoffs } from "./impersonation-handoffs";
import { LifecycleWriteGuard } from "./lifecycle-write-guard";
import { AuthRepository } from "./repository";

type HandoffTarget = NonNullable<
	Effect.Success<ReturnType<AuthRepository["Service"]["findUserById"]>>
>;

const targetUser: HandoffTarget = {
	image: null,
	id: "target-1",
	name: "Target",
	disabledAt: null,
	email: "target@example.com",
	accountGeneration: "test-account-generation",
	bootstrapCompletedAt: new Date("2026-09-01T00:00:00.000Z"),
	preferences: { language: null, disableIntegrations: false },
};

const authorization = (
	overrides: Partial<ImpersonationAuthorization> = {},
): ImpersonationAuthorization => ({
	nonce: "nonce_12345678901",
	state: "state_123456789012",
	codeChallenge: "C".repeat(43),
	clientId: OAUTH_IMPERSONATION_WEB_CLIENT_ID,
	redirectUri: "https://frontend.example/auth/callback",
	...overrides,
});

class HandoffTestState extends Context.Service<
	HandoffTestState,
	{
		readonly setUser: (user: HandoffTarget | null) => Effect.Effect<void>;
		readonly setLifecycleActive: (active: boolean) => Effect.Effect<void>;
		readonly userReads: Effect.Effect<ReadonlyArray<string>>;
		readonly lifecycleReads: Effect.Effect<ReadonlyArray<string>>;
		readonly values: Effect.Effect<ReadonlyMap<string, string>>;
		readonly expiries: Effect.Effect<ReadonlyMap<string, number>>;
	}
>()("test/HandoffTestState") {}

const makeLayer = () =>
	Layer.unwrap(
		Effect.gen(function* () {
			const user = yield* Ref.make<HandoffTarget | null>(targetUser);
			const lifecycleActive = yield* Ref.make(false);
			const userReads = yield* Ref.make<ReadonlyArray<string>>([]);
			const lifecycleReads = yield* Ref.make<ReadonlyArray<string>>([]);
			const values = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
			const expiries = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
			const runPromise = Effect.runPromiseWith(yield* Effect.context());
			const client: RedisService["Service"]["client"] = Object.assign(
				Object.create(Redis.prototype),
				{
					eval: (_script: string, _keyCount: number, key: string) =>
						runPromise(
							Ref.modify(values, (current) => {
								const next = new Map(current);
								next.delete(key);
								return [current.get(key) ?? null, next];
							}),
						),
					set: (key: string, value: string, _expiryMode: "EX", ttlSeconds: number) =>
						runPromise(
							Ref.update(values, (current) => new Map(current).set(key, value)).pipe(
								Effect.andThen(
									Ref.update(expiries, (current) => new Map(current).set(key, ttlSeconds)),
								),
								Effect.as("OK"),
							),
						),
				},
			);
			const repository = Layer.mock(AuthRepository)({
				findUserById: (userId) =>
					Ref.update(userReads, (reads) => [...reads, userId]).pipe(Effect.andThen(Ref.get(user))),
			});
			const lifecycle = Layer.mock(LifecycleWriteGuard)({
				isActive: (userId) =>
					Ref.update(lifecycleReads, (reads) => [...reads, userId]).pipe(
						Effect.andThen(Ref.get(lifecycleActive)),
					),
			});

			return Layer.effect(ImpersonationHandoffs, ImpersonationHandoffs.make).pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						makeAppConfigLayer({ frontendUrl: "https://frontend.example" }),
						Layer.succeed(RedisService, makeRedisService({ client })),
						repository,
						lifecycle,
					),
				),
				Layer.merge(
					Layer.succeed(HandoffTestState, {
						values: Ref.get(values),
						expiries: Ref.get(expiries),
						userReads: Ref.get(userReads),
						lifecycleReads: Ref.get(lifecycleReads),
						setUser: (value) => Ref.set(user, value),
						setLifecycleActive: (value) => Ref.set(lifecycleActive, value),
					}),
				),
			);
		}),
	);

const failure = <A, E>(exit: Exit.Exit<A, E>) => {
	assert(Exit.isFailure(exit));
	const error = Cause.findErrorOption(exit.cause);
	assert(Option.isSome(error));
	return error.value;
};

layer(makeLayer())((test) => {
	test.effect("requires an existing, enabled, initialized, lifecycle-idle target", () =>
		Effect.gen(function* () {
			const service = yield* ImpersonationHandoffs;
			const state = yield* HandoffTestState;
			const userId = UserId.make(targetUser.id);

			yield* state.setUser(null);
			expect(failure(yield* Effect.exit(service.create(userId, authorization())))).toEqual(
				new GodModeNotFound({ reason: { userId, code: "user-not-found" } }),
			);

			yield* state.setUser({ ...targetUser, disabledAt: targetUser.bootstrapCompletedAt });
			expect(failure(yield* Effect.exit(service.create(userId, authorization())))).toEqual(
				new GodModeRequestFailure({ reason: { code: "user-disabled" } }),
			);

			yield* state.setUser({ ...targetUser, bootstrapCompletedAt: null });
			expect(failure(yield* Effect.exit(service.create(userId, authorization())))).toEqual(
				new GodModeRequestFailure({ reason: { code: "user-initializing" } }),
			);

			yield* state.setUser(targetUser);
			yield* state.setLifecycleActive(true);
			expect(failure(yield* Effect.exit(service.create(userId, authorization())))).toEqual(
				new GodModeRequestFailure({ reason: { code: "user-unavailable" } }),
			);
			expect(yield* state.userReads).toEqual([
				targetUser.id,
				targetUser.id,
				targetUser.id,
				targetUser.id,
			]);
			expect(yield* state.lifecycleReads).toEqual([userId]);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("rejects untrusted redirects and malformed authorization challenges", () =>
		Effect.gen(function* () {
			const service = yield* ImpersonationHandoffs;
			const userId = UserId.make(targetUser.id);
			const invalid = [
				authorization({ redirectUri: "https://attacker.example/auth/callback" }),
				authorization({ codeChallenge: "too-short" }),
				authorization({ state: "short" }),
				authorization({ nonce: "short" }),
			];

			for (const value of invalid) {
				expect(failure(yield* Effect.exit(service.create(userId, value)))).toEqual(
					new GodModeRequestFailure({ reason: { code: "invalid-impersonation-authorization" } }),
				);
			}
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("builds the authorization URL from the configured frontend origin", () =>
		Effect.gen(function* () {
			const service = yield* ImpersonationHandoffs;
			const state = yield* HandoffTestState;
			const userId = UserId.make(targetUser.id);
			const now = yield* Clock.currentTimeMillis;
			const authorizationValue = authorization();
			const created = yield* service.create(userId, authorizationValue);

			expect(created.expiresAt).toBe(now + IMPERSONATION_HANDOFF_TTL_SECONDS * 1_000);
			const [key] = (yield* state.values).keys();
			assert(key !== undefined);
			expect((yield* state.expiries).get(key)).toBe(IMPERSONATION_HANDOFF_TTL_SECONDS);
			expect(key).not.toContain(created.ticket);

			const consumed = yield* service.consume(created.ticket);
			const url = new URL(consumed.authorizationUrl);
			expect(consumed.userId).toBe(targetUser.id);
			expect(url.origin).toBe("https://frontend.example");
			expect(url.pathname).toBe("/api/auth/oauth2/authorize");
			expect(url.searchParams.get("client_id")).toBe(authorizationValue.clientId);
			expect(url.searchParams.get("redirect_uri")).toBe(authorizationValue.redirectUri);
			expect(url.searchParams.get("state")).toBe(authorizationValue.state);
			expect(url.searchParams.get("nonce")).toBe(authorizationValue.nonce);
			expect(url.searchParams.get("code_challenge")).toBe(authorizationValue.codeChallenge);
			expect(yield* state.userReads).toEqual([targetUser.id, targetUser.id]);
			expect(yield* state.lifecycleReads).toEqual([userId, userId]);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("keeps a native PKCE challenge without storing a verifier", () =>
		Effect.gen(function* () {
			const service = yield* ImpersonationHandoffs;
			const userId = UserId.make(targetUser.id);
			const nativeAuthorization = authorization({
				codeChallenge: "N".repeat(43),
				clientId: OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
				redirectUri: getNativeOAuthCallbackUri("io.ryot.app"),
			});
			const { ticket } = yield* service.create(userId, nativeAuthorization);
			const { authorizationUrl } = yield* service.consume(ticket);
			const url = new URL(authorizationUrl);

			expect(url.searchParams.get("redirect_uri")).toBe(nativeAuthorization.redirectUri);
			expect(url.searchParams.get("code_challenge")).toBe(nativeAuthorization.codeChallenge);
			expect(url.searchParams.get("code_challenge_method")).toBe("S256");
			expect(url.searchParams.has("code_verifier")).toBe(false);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("rechecks the current target after consuming the handoff", () =>
		Effect.gen(function* () {
			const service = yield* ImpersonationHandoffs;
			const state = yield* HandoffTestState;
			const userId = UserId.make(targetUser.id);
			const { ticket } = yield* service.create(userId, authorization());
			yield* state.setUser({ ...targetUser, disabledAt: targetUser.bootstrapCompletedAt });

			expect(failure(yield* Effect.exit(service.consume(ticket)))).toEqual(
				new GodModeRequestFailure({ reason: { code: "user-disabled" } }),
			);
			expect(yield* state.userReads).toEqual([targetUser.id, targetUser.id]);
			expect(yield* state.values).toHaveLength(0);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("atomically consumes each handoff once", () =>
		Effect.gen(function* () {
			const service = yield* ImpersonationHandoffs;
			const { ticket } = yield* service.create(UserId.make(targetUser.id), authorization());
			const exits = yield* Effect.forEach(
				[service.consume(ticket), service.consume(ticket)],
				Effect.exit,
				{ concurrency: "unbounded" },
			);

			expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
			expect(exits.filter(Exit.isFailure)).toHaveLength(1);
			const failed = exits.find(Exit.isFailure);
			assert(failed !== undefined);
			expect(failure(failed)).toBeInstanceOf(ImpersonationHandoffInvalid);
		}),
	);
});
