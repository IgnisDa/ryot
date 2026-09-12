import { describe, expect, layer } from "@effect/vitest";
import {
	OAUTH_WEB_CLIENT_ID,
	type PendingAuthorization,
	type StoredTokenSet,
} from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Exit, Layer, Ref } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	OAuthLauncher,
	OAuthLauncherError,
	type OAuthLaunchPlan,
} from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { GodModeImpersonationService } from "#/modules/god-mode/impersonation";
import { GodModeService } from "#/modules/god-mode/service";

const origin = decodeServerOrigin("https://ryot.example");
const pending = {
	createdAt: 1,
	state: "state-1",
	nonce: "nonce-1",
	destination: "/",
	serverOrigin: origin,
	codeVerifier: "verifier-secret",
	clientId: "ryot-impersonation-web",
	redirectUri: `${origin}/auth/callback`,
} satisfies PendingAuthorization;

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

const originalTokens: StoredTokenSet = {
	tokenType: "Bearer",
	scope: "openid ryot:api",
	idToken: "original-id-token",
	clientId: OAUTH_WEB_CLIENT_ID,
	accessTokenExpiresAt: 100_000,
	accessToken: "original-access-token",
	refreshToken: "original-refresh-token",
};

type ImpersonationEvent = { readonly kind: string; readonly [key: string]: unknown };
type FailureStage = "admin" | "launch";

class ImpersonationProbe extends Context.Service<
	ImpersonationProbe,
	{
		readonly events: Effect.Effect<ReadonlyArray<ImpersonationEvent>>;
		readonly authorization: unknown;
	}
>()("test/ImpersonationProbe") {}

const impersonationLayer = (failure?: FailureStage) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<ImpersonationEvent>>([]);
			const storedTokens = yield* Ref.make<StoredTokenSet | null>(originalTokens);
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
			const godMode: GodModeService["Service"] = {
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
				launch: (_plan, authorizationUrl) => {
					const launched = record({ kind: "launch", authorizationUrl });
					return failure === "launch"
						? launched.pipe(
								Effect.andThen(Effect.fail(new OAuthLauncherError({ reason: "launch-failed" }))),
							)
						: launched;
				},
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
				Layer.succeed(GodModeService, godMode),
				Layer.succeed(OAuthLauncher, launcher),
				Layer.succeed(ImpersonationProbe, { authorization, events: Ref.get(events) }),
			);
			return Layer.merge(
				dependencies,
				GodModeImpersonationService.layer.pipe(Layer.provide(dependencies)),
			);
		}),
	);

describe("God Mode impersonation", () => {
	layer(impersonationLayer())((test) => {
		test.effect("keeps PKCE on the initiating device and launches the one-use handoff", () =>
			Effect.gen(function* () {
				const service = yield* GodModeImpersonationService;
				const probe = yield* ImpersonationProbe;
				const storage = yield* OAuthStorage;
				yield* service.start("god-session", UserId.make("user-1"), origin);

				expect(yield* probe.events).toEqual([
					{ server: origin, kind: "prepare" },
					{ value: pending, kind: "pending" },
					{
						kind: "admin",
						sessionId: "god-session",
						userId: UserId.make("user-1"),
						authorization: probe.authorization,
					},
					{ kind: "launch", authorizationUrl: `${origin}/oauth/impersonate#ticket=one-use-ticket` },
				]);
				expect((yield* probe.events).filter(({ kind }) => kind === "pending")).toHaveLength(1);
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
				const service = yield* GodModeImpersonationService;
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

	layer(impersonationLayer("launch"))((test) => {
		test.effect("keeps the existing token set when launch fails", () =>
			Effect.gen(function* () {
				const service = yield* GodModeImpersonationService;
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
					"launch",
				]);
				expect(yield* storage.getTokenSet(origin)).toEqual(originalTokens);
			}),
		);
	});
});
