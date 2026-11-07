import { expect } from "bun:test";

import {
	InstanceAdminNotFound,
	InstanceAdminRequestFailure,
} from "@ryot-app/contract/modules/instance-admin/contract";
import {
	getNativeOAuthCallbackUri,
	IMPERSONATION_HANDOFF_TTL_SECONDS,
	OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
	OAUTH_IMPERSONATION_WEB_CLIENT_ID,
} from "@ryot-app/contract/oauth";
import type { ImpersonationAuthorization } from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Cause, Clock, Context, Effect, Exit, Layer, Option, Ref } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { TransientValues } from "#platform/transient-values";
import { transientValue } from "#schema/tables/transient-values";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

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
	bootstrapCompletedAt: new Date("2026-09-01T00:00:00.000Z"),
	preferences: { language: null, reportingTimeZone: UTC, disableIntegrations: false },
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
		readonly userReads: Effect.Effect<ReadonlyArray<string>>;
		readonly lifecycleReads: Effect.Effect<ReadonlyArray<string>>;
		readonly setUser: (user: null | HandoffTarget) => Effect.Effect<void>;
		readonly setLifecycleActive: (active: boolean) => Effect.Effect<void>;
	}
>()(
	"@ryot-app/kernel-backend/modules/accounts/auth/impersonation-handoffs.test/HandoffTestState",
) {}

const makeLayer = () =>
	Layer.unwrap(
		Effect.gen(function* () {
			const user = yield* Ref.make<null | HandoffTarget>(targetUser);
			const lifecycleActive = yield* Ref.make(false);
			const userReads = yield* Ref.make<ReadonlyArray<string>>([]);
			const lifecycleReads = yield* Ref.make<ReadonlyArray<string>>([]);
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
						TransientValues.layer.pipe(Layer.provideMerge(isolatedDatabaseLayer("handoffs"))),
						repository,
						lifecycle,
					),
				),
				Layer.merge(
					Layer.succeed(HandoffTestState, {
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
	test.effect(
		"requires an existing, enabled, initialized, lifecycle-idle target",
		() =>
			Effect.gen(function* () {
				const service = yield* ImpersonationHandoffs;
				const state = yield* HandoffTestState;
				const userId = UserId.make(targetUser.id);

				yield* state.setUser(null);
				expect(failure(yield* Effect.exit(service.create(userId, authorization())))).toEqual(
					new InstanceAdminNotFound({ reason: { userId, code: "user-not-found" } }),
				);

				yield* state.setUser({ ...targetUser, disabledAt: targetUser.bootstrapCompletedAt });
				expect(failure(yield* Effect.exit(service.create(userId, authorization())))).toEqual(
					new InstanceAdminRequestFailure({ reason: { code: "user-disabled" } }),
				);

				yield* state.setUser({ ...targetUser, bootstrapCompletedAt: null });
				expect(failure(yield* Effect.exit(service.create(userId, authorization())))).toEqual(
					new InstanceAdminRequestFailure({ reason: { code: "user-initializing" } }),
				);

				yield* state.setUser(targetUser);
				yield* state.setLifecycleActive(true);
				expect(failure(yield* Effect.exit(service.create(userId, authorization())))).toEqual(
					new InstanceAdminRequestFailure({ reason: { code: "user-unavailable" } }),
				);
				expect(yield* state.userReads).toEqual([
					targetUser.id,
					targetUser.id,
					targetUser.id,
					targetUser.id,
				]);
				expect(yield* state.lifecycleReads).toEqual([userId]);
			}),
		testTimeout,
	);
});

layer(makeLayer())((test) => {
	test.effect(
		"rejects untrusted redirects and malformed authorization challenges",
		() =>
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
						new InstanceAdminRequestFailure({
							reason: { code: "invalid-impersonation-authorization" },
						}),
					);
				}
			}),
		testTimeout,
	);
});

layer(makeLayer())((test) => {
	test.effect(
		"builds the authorization URL from the configured frontend origin",
		() =>
			Effect.gen(function* () {
				const service = yield* ImpersonationHandoffs;
				const state = yield* HandoffTestState;
				const userId = UserId.make(targetUser.id);
				const now = yield* Clock.currentTimeMillis;
				const authorizationValue = authorization();
				const created = yield* service.create(userId, authorizationValue);

				expect(created.expiresAt).toBe(now + IMPERSONATION_HANDOFF_TTL_SECONDS * 1_000);
				const stored = yield* (yield* DatabaseSession).run((db) =>
					db.select().from(transientValue),
				);
				expect(stored).toHaveLength(1);
				expect(stored[0]?.key).not.toContain(created.ticket);
				expect(stored[0]?.expiresAt?.getTime()).toBeGreaterThan(now);

				const consumed = yield* service.consume(created.ticket);
				const url = new URL(consumed.authorizationUrl);
				expect(consumed.userId).toBe<unknown>(targetUser.id);
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
		testTimeout,
	);
});

layer(makeLayer())((test) => {
	test.effect(
		"keeps a native PKCE challenge without storing a verifier",
		() =>
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
		testTimeout,
	);
});

layer(makeLayer())((test) => {
	test.effect(
		"rechecks the current target after consuming the handoff",
		() =>
			Effect.gen(function* () {
				const service = yield* ImpersonationHandoffs;
				const state = yield* HandoffTestState;
				const userId = UserId.make(targetUser.id);
				const { ticket } = yield* service.create(userId, authorization());
				yield* state.setUser({ ...targetUser, disabledAt: targetUser.bootstrapCompletedAt });

				expect(failure(yield* Effect.exit(service.consume(ticket)))).toEqual(
					new InstanceAdminRequestFailure({ reason: { code: "user-disabled" } }),
				);
				expect(yield* state.userReads).toEqual([targetUser.id, targetUser.id]);
				expect(
					yield* (yield* DatabaseSession).run((db) => db.select().from(transientValue)),
				).toEqual([]);
			}),
		testTimeout,
	);
});

layer(makeLayer())((test) => {
	test.effect(
		"atomically consumes each handoff once",
		() =>
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
		testTimeout,
	);
});
