import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import {
	getWebOAuthLogoutCallbackUri,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot/contract/oauth";
import { Context, Effect, Layer } from "effect";

import { normalizeServerOrigin, type ServerOrigin } from "#/api/origin";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { isNativePlatform } from "#/modules/navigation/native-navigation";
import { ClientStorage } from "#/persistence/storage";

export type AuthSessionSnapshot =
	| { readonly status: "pending" }
	| { readonly status: "missing" }
	| {
			readonly status: "authenticated";
			readonly user: {
				readonly id: string;
				readonly name: string;
				readonly email: string;
				readonly image: string | null;
			};
	  };

export type SettledAuthSession = Exclude<AuthSessionSnapshot, { readonly status: "pending" }>;

export type AuthSessionStore = {
	readonly getSnapshot: () => AuthSessionSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
};

export const toAuthSessionState = (session: SettledAuthSession) =>
	session.status === "authenticated"
		? { status: "authenticated" as const, userId: session.user.id }
		: { status: "missing" as const };

const makeSessionStore = () => {
	let snapshot: AuthSessionSnapshot = { status: "pending" };
	const listeners = new Set<() => void>();
	return {
		store: {
			getSnapshot: () => snapshot,
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		set: (next: AuthSessionSnapshot) => {
			snapshot = next;
			listeners.forEach((listener) => listener());
		},
	};
};

export class AuthService extends Context.Service<AuthService>()("AuthService", {
	make: Effect.gen(function* () {
		const storage = yield* ClientStorage;
		const tokens = yield* OAuthTokenService;
		const sessions = new Map<ServerOrigin, ReturnType<typeof makeSessionStore>>();
		const getSession = (origin: ServerOrigin) => {
			const canonical = normalizeServerOrigin(origin);
			const existing = sessions.get(canonical);
			if (existing) {
				return existing;
			}
			const created = makeSessionStore();
			sessions.set(canonical, created);
			return created;
		};
		const settledSession = Effect.fn("AuthService.settledSession")(function* (
			origin: ServerOrigin,
		) {
			const session = getSession(origin);
			session.set({ status: "pending" });
			const user = yield* tokens
				.userInfo(origin, isNativePlatform() ? OAUTH_NATIVE_CLIENT_ID : OAUTH_WEB_CLIENT_ID)
				.pipe(
					Effect.catchTag("OAuthTokenError", (error) =>
						error.reason === "invalid-grant" || error.reason === "missing-authorization"
							? Effect.succeed(null)
							: Effect.fail(error),
					),
				);
			const snapshot: SettledAuthSession = user
				? {
						status: "authenticated",
						user: {
							id: user.sub,
							email: user.email ?? "",
							image: user.picture ?? null,
							name: user.name ?? user.email ?? user.sub,
						},
					}
				: { status: "missing" };
			session.set(snapshot);
			return snapshot;
		});
		const clearSession = Effect.fn("AuthService.clearSession")(function* (origin: ServerOrigin) {
			yield* tokens.clear(origin);
			getSession(origin).set({ status: "missing" });
		});
		const signOut = Effect.fn("AuthService.signOut")(function* (origin: ServerOrigin) {
			const isNative = isNativePlatform();
			const applicationId = isNative
				? yield* Effect.tryPromise(() => App.getInfo().then((info) => info.id)).pipe(
						Effect.catch(() => Effect.succeed(null)),
					)
				: undefined;
			if (isNative && applicationId !== "io.ryot.app" && applicationId !== "io.ryot.app.dev") {
				yield* clearSession(origin);
				return false;
			}
			const endSessionUrl = yield* tokens.logout(
				origin,
				isNative ? OAUTH_NATIVE_CLIENT_ID : OAUTH_WEB_CLIENT_ID,
				isNative ? `${applicationId}:/auth/logout/callback` : getWebOAuthLogoutCallbackUri(origin),
			);
			getSession(origin).set({ status: "missing" });
			if (!endSessionUrl) {
				return false;
			}
			if (isNative) {
				return yield* Effect.tryPromise(() => Browser.open({ url: endSessionUrl })).pipe(
					Effect.as(true),
					Effect.catch(() => Effect.succeed(false)),
				);
			}
			yield* Effect.sync(() => window.location.assign(endSessionUrl));
			return true;
		});
		const changeServer = Effect.fn("AuthService.changeServer")(function* (
			origin: ServerOrigin | null,
		) {
			if (origin) {
				yield* clearSession(origin);
			}
			yield* storage.clearServerSelection;
		});

		return {
			signOut,
			changeServer,
			settledSession,
			session: (origin: ServerOrigin) => getSession(origin).store,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
