import { Browser } from "@capacitor/browser";
import type { AccessClass, ImpersonationSession } from "@ryot-app/contract/oauth";
import { Context, Effect, Layer, Result } from "effect";

import type { ServerOrigin } from "#/api/origin";
import type { Authorization } from "#/modules/auth/authorization";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import type { OAuthTokenError } from "#/modules/auth/token-service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { ClientStorage } from "#/persistence/storage";

export type SettledAuthSession = Exclude<AuthSessionSnapshot, { readonly status: "pending" }>;

export type AuthSessionStore = {
	readonly getSnapshot: () => AuthSessionSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
};

export type AuthSessionSnapshot =
	| { readonly status: "pending" }
	| { readonly status: "missing" }
	| {
			readonly status: "authenticated";
			readonly accessClass: AccessClass;
			readonly impersonation?: ImpersonationSession;
			readonly user: {
				readonly id: string;
				readonly name: string;
				readonly email: string;
				readonly image: null | string;
			};
	  };

export const toAuthSessionState = (session: SettledAuthSession) =>
	session.status === "authenticated"
		? { userId: session.user.id, status: "authenticated" as const }
		: { status: "missing" as const };

const isLostAuthorization = (error: OAuthTokenError) =>
	error.reason === "invalid-grant" || error.reason === "missing-authorization";

export class AuthService extends Context.Service<AuthService>()("AuthService", {
	make: Effect.gen(function* () {
		const storage = yield* ClientStorage;
		const tokens = yield* OAuthTokenService;
		const runtimeClient = yield* RuntimeOAuthClientService;
		const resolveUserInfo = Effect.fnUntraced(function* (
			canonical: ServerOrigin,
			authorization: Authorization,
		) {
			const user = yield* tokens
				.userInfo(canonical, authorization)
				.pipe(
					Effect.catchTag("OAuthTokenError", (error) =>
						isLostAuthorization(error) ? Effect.succeed(null) : Effect.fail(error),
					),
				);
			const snapshot: SettledAuthSession = user
				? {
						status: "authenticated",
						accessClass: user.accessClass,
						user: {
							id: user.sub,
							email: user.email ?? "",
							image: user.picture ?? null,
							name: user.name ?? user.email ?? user.sub,
						},
						...(user.impersonation === undefined ? {} : { impersonation: user.impersonation }),
					}
				: { status: "missing" };
			tokens.authorization.forServer(canonical).publish(authorization, snapshot);
			return snapshot;
		});
		const settledSession = Effect.fn("AuthService.settledSession")(function* (
			origin: ServerOrigin,
			forceRefresh = false,
		) {
			const session = tokens.authorization.forServer(origin);
			let refresh = forceRefresh;
			for (;;) {
				const { result, authorization } = yield* tokens.access(origin);
				const cached = session.store.getSnapshot();
				if (
					Result.isFailure(result) ? isLostAuthorization(result.failure) : result.success === null
				) {
					const snapshot: SettledAuthSession = { status: "missing" };
					session.publish(authorization, snapshot);
					return snapshot;
				}
				if (!session.isCurrent(authorization)) {
					refresh = false;
					continue;
				}
				if (Result.isFailure(result)) {
					return cached.status === "pending" ? yield* result.failure : cached;
				}
				if (!refresh && cached.status === "authenticated") {
					return cached;
				}
				const resolved = yield* authorization
					.resolution(resolveUserInfo(origin, authorization))
					.pipe(Effect.result);
				if (!session.isCurrent(authorization)) {
					refresh = false;
					continue;
				}
				return resolved._tag === "Failure" ? yield* resolved.failure : resolved.success;
			}
		});
		const clearSession = Effect.fn("AuthService.clearSession")(function* (origin: ServerOrigin) {
			yield* tokens.clear(origin);
		});
		const signOut = Effect.fn("AuthService.signOut")(function* (origin: ServerOrigin) {
			const client = yield* runtimeClient
				.forServer(origin)
				.pipe(
					Effect.catchTag("RuntimeOAuthClientError", () =>
						clearSession(origin).pipe(Effect.as(null)),
					),
				);
			if (client === null) {
				return false;
			}
			const endSessionUrl = yield* tokens.logout(origin, client.logoutUri);
			if (!endSessionUrl) {
				return false;
			}
			if (client.nativeApplicationId !== null) {
				return yield* Effect.tryPromise(() => Browser.open({ url: endSessionUrl })).pipe(
					Effect.as(true),
					Effect.orElseSucceed(() => false),
				);
			}
			yield* Effect.sync(() => window.location.assign(endSessionUrl));
			return true;
		});
		const changeServer = Effect.fn("AuthService.changeServer")(function* (
			origin: null | ServerOrigin,
		) {
			if (origin) {
				yield* clearSession(origin);
			}
			yield* storage.clearServerSelection;
		});

		return {
			signOut,
			clearSession,
			changeServer,
			settledSession,
			session: (origin: ServerOrigin) => tokens.authorization.forServer(origin).store,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
