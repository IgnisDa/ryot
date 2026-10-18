import { describe, expect, layer } from "@effect/vitest";
import type { StoredTokenSet } from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Exit, Layer, Ref } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	OAuthLauncher,
	OAuthLauncherError,
	type OAuthLaunchPlan,
} from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import {
	makePendingAuthorization,
	makeStoredTokenSet,
} from "#/modules/auth/oauth-storage.test-support";
import { InstanceAdminImpersonationService } from "#/modules/instance-admin/impersonation";
import { InstanceAdminService } from "#/modules/instance-admin/service";

const origin = decodeServerOrigin("https://ryot.example");
const pending = makePendingAuthorization(origin, {
	state: "state-1",
	nonce: "nonce-1",
	codeVerifier: "verifier-secret",
	clientId: "ryot-impersonation-web",
});

const plan: OAuthLaunchPlan = {
	pending,
	codeChallenge: "challenge-1",
	authorizationUrl: `${origin}/api/auth/oauth2/authorize`,
	client: {
		nativeApplicationId: null,
		clientId: pending.clientId,
		callbackUri: pending.redirectUri,
		logoutUri: `${origin}/auth/logout/callback`,
	},
};

const originalTokens = makeStoredTokenSet({
	scope: "openid ryot:api",
	idToken: "original-id-token",
	accessTokenExpiresAt: 100_000,
	accessToken: "original-access-token",
	refreshToken: "original-refresh-token",
});

type ImpersonationEvent = { readonly kind: string; readonly [key: string]: unknown };

class ImpersonationProbe extends Context.Service<
	ImpersonationProbe,
	{
		readonly authorization: unknown;
		readonly events: Effect.Effect<ReadonlyArray<ImpersonationEvent>>;
	}
>()("test/ImpersonationProbe") {}

const impersonationLayer = (failure?: "admin") =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<ImpersonationEvent>>([]);
			const storedTokens = yield* Ref.make<null | StoredTokenSet>(originalTokens);
			const record = (event: ImpersonationEvent) =>
				Ref.update(events, (previous) => [...previous, event]);
			const storage: OAuthStorage["Service"] = {
				removePending: () => Effect.void,
				getPending: () => Effect.succeed(null),
				takePending: () => Effect.succeed(null),
				setPending: (value) => record({ value, kind: "pending" }),
				clearPending: (server) => record({ server, kind: "clear-pending" }),
				getTokenSet: (server) => (server === origin ? Ref.get(storedTokens) : Effect.succeed(null)),
				setTokenSet: (server, value) =>
					server === origin ? Ref.set(storedTokens, value) : Effect.void,
				removeTokenSet: (server) =>
					(server === origin ? Ref.set(storedTokens, null) : Effect.void).pipe(
						Effect.andThen(record({ server, kind: "remove-tokens" })),
					),
			};
			const authorization = {
				nonce: pending.nonce,
				state: pending.state,
				clientId: pending.clientId,
				redirectUri: pending.redirectUri,
				codeChallenge: plan.codeChallenge,
			};
			const instanceAdmin: InstanceAdminService["Service"] = {
				listLogs: () => Effect.die("not used"),
				listUsers: () => Effect.die("not used"),
				resetUser: () => Effect.die("not used"),
				deleteUser: () => Effect.die("not used"),
				downloadLogs: () => Effect.die("not used"),
				setUserDisabled: () => Effect.die("not used"),
				resetUserPassword: () => Effect.die("not used"),
				getMigrationReport: () => Effect.die("not used"),
				startUserImpersonation: (sessionId, userId, request) =>
					record({ userId, sessionId, kind: "admin", authorization: request }).pipe(
						Effect.andThen(
							failure === "admin"
								? Effect.die("admin request failed")
								: Effect.succeed({ expiresAt: 60_000, ticket: "one-use-ticket" }),
						),
					),
			};
			const launcher: OAuthLauncher["Service"] = {
				prepare: () => Effect.die("not used"),
				launch: () => Effect.die("must not launch while generating a link"),
				prepareImpersonation: (server) =>
					record({ server, kind: "prepare" }).pipe(
						Effect.andThen(storage.setPending(pending)),
						Effect.catchTag("OAuthStorageError", (cause) =>
							Effect.fail(new OAuthLauncherError({ cause, reason: "storage-failed" })),
						),
						Effect.as(plan),
					),
			};
			const dependencies = Layer.mergeAll(
				Layer.succeed(OAuthStorage, storage),
				Layer.succeed(InstanceAdminService, instanceAdmin),
				Layer.succeed(OAuthLauncher, launcher),
				Layer.succeed(ImpersonationProbe, { authorization, events: Ref.get(events) }),
			);
			return Layer.merge(
				dependencies,
				InstanceAdminImpersonationService.layer.pipe(Layer.provide(dependencies)),
			);
		}),
	);

describe("Instance Admin impersonation", () => {
	layer(impersonationLayer())((test) => {
		test.effect(
			"keeps PKCE on the initiating device and returns the handoff without launching",
			() =>
				Effect.gen(function* () {
					const service = yield* InstanceAdminImpersonationService;
					const probe = yield* ImpersonationProbe;
					const storage = yield* OAuthStorage;
					const url = yield* service.start("god-session", UserId.make("user-1"), origin);
					expect(url).toBe(`${origin}/oauth/impersonate#ticket=one-use-ticket`);

					expect(yield* probe.events).toEqual([
						{ server: origin, kind: "prepare" },
						{ value: pending, kind: "pending" },
						{
							kind: "admin",
							sessionId: "god-session",
							userId: UserId.make("user-1"),
							authorization: probe.authorization,
						},
					]);
					expect(yield* storage.getTokenSet(origin)).toEqual(originalTokens);
					expect(probe.authorization).toEqual({
						nonce: pending.nonce,
						state: pending.state,
						clientId: pending.clientId,
						redirectUri: pending.redirectUri,
						codeChallenge: plan.codeChallenge,
					});
				}),
		);
	});

	layer(impersonationLayer("admin"))((test) => {
		test.effect("keeps the existing token set when the admin request fails", () =>
			Effect.gen(function* () {
				const service = yield* InstanceAdminImpersonationService;
				const probe = yield* ImpersonationProbe;
				const storage = yield* OAuthStorage;
				const exit = yield* Effect.exit(
					service.start("god-session", UserId.make("user-1"), origin),
				);

				expect(Exit.isFailure(exit)).toBe(true);
				expect((yield* probe.events).map(({ kind }) => kind)).toEqual([
					"prepare",
					"pending",
					"admin",
				]);
				expect(yield* storage.getTokenSet(origin)).toEqual(originalTokens);
			}),
		);
	});
});
