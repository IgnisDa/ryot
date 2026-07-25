import { Browser } from "@capacitor/browser";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { Context, Effect, Layer } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { makeOriginSingleFlight } from "#/modules/auth/single-flight";
import type { OAuthTokenError } from "#/modules/auth/token-service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { ClientStorage } from "#/persistence/storage";

export type AuthSessionSnapshot =
	| { readonly status: "pending" }
	| { readonly status: "missing" }
	| {
			readonly status: "authenticated";
			readonly accessClass: AccessClass;
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

type AuthorizationProbe =
	| { readonly kind: "authorized" }
	| { readonly kind: "unauthorized" }
	| { readonly kind: "indeterminate"; readonly fallback: SettledAuthSession };

export const toAuthSessionState = (session: SettledAuthSession) =>
	session.status === "authenticated"
		? { userId: session.user.id, status: "authenticated" as const }
		: { status: "missing" as const };

const isLostAuthorization = (error: OAuthTokenError) =>
	error.reason === "invalid-grant" || error.reason === "missing-authorization";

const makeSessionStore = () => {
	let snapshot: AuthSessionSnapshot = { status: "pending" };
	const listeners = new Set<() => void>();
	return {
		set: (next: AuthSessionSnapshot) => {
			snapshot = next;
			listeners.forEach((listener) => listener());
		},
		store: {
			getSnapshot: () => snapshot,
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
	};
};

export class AuthService extends Context.Service<AuthService>()("AuthService", {
	make: Effect.gen(function* () {
		const storage = yield* ClientStorage;
		const tokens = yield* OAuthTokenService;
		const runtimeClient = yield* RuntimeOAuthClientService;
		const sessions = new Map<ServerOrigin, ReturnType<typeof makeSessionStore>>();
		const resolutions = makeOriginSingleFlight<SettledAuthSession, OAuthTokenError>();
		const getSession = (origin: ServerOrigin) => {
			const existing = sessions.get(origin);
			if (existing) {
				return existing;
			}
			const created = makeSessionStore();
			sessions.set(origin, created);
			return created;
		};
		const resolveUserInfo = (canonical: ServerOrigin) =>
			Effect.gen(function* () {
				const user = yield* tokens
					.userInfo(canonical)
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
						}
					: { status: "missing" };
				getSession(canonical).set(snapshot);
				return snapshot;
			});
		const settledSession = Effect.fn("AuthService.settledSession")(function* (
			origin: ServerOrigin,
			forceRefresh = false,
		) {
			const session = getSession(origin);
			const cached = session.store.getSnapshot();
			const probe = yield* tokens.accessToken(origin).pipe(
				Effect.map(
					(token): AuthorizationProbe => ({ kind: token === null ? "unauthorized" : "authorized" }),
				),
				Effect.catchTag("OAuthTokenError", (error) => {
					if (isLostAuthorization(error)) {
						return Effect.succeed<AuthorizationProbe>({ kind: "unauthorized" });
					}
					if (cached.status === "pending") {
						return Effect.fail(error);
					}
					return Effect.succeed<AuthorizationProbe>({ fallback: cached, kind: "indeterminate" });
				}),
			);
			if (probe.kind === "indeterminate") {
				return probe.fallback;
			}
			if (probe.kind === "unauthorized") {
				const snapshot: SettledAuthSession = { status: "missing" };
				if (cached.status !== "missing") {
					session.set(snapshot);
				}
				return snapshot;
			}
			if (!forceRefresh && cached.status === "authenticated") {
				return cached;
			}
			return yield* resolutions(origin, resolveUserInfo(origin));
		});
		const clearSession = Effect.fn("AuthService.clearSession")(function* (origin: ServerOrigin) {
			yield* tokens.clear(origin);
			getSession(origin).set({ status: "missing" });
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
			getSession(origin).set({ status: "missing" });
			if (!endSessionUrl) {
				return false;
			}
			if (client.nativeApplicationId !== null) {
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
