import { createAuthClient } from "better-auth/client";
import { oneTimeTokenClient, twoFactorClient } from "better-auth/client/plugins";
import { Context, Data, Effect, Layer } from "effect";

import { normalizeServerOrigin, type ServerOrigin } from "#/api/origin";
import type { TwoFactorMethod } from "#/modules/auth/flow";
import type { CredentialsValues } from "#/modules/auth/form-values";
import { ClientStorage } from "#/persistence/storage";

export const SESSION_TOKEN_HEADER = "set-auth-token";
export const TWO_FACTOR_TOKEN_HEADER = "x-two-factor-token";
export const SET_TWO_FACTOR_TOKEN_HEADER = "set-two-factor-token";

export const BETTER_AUTH_STORAGE_KEYS = ["better-auth.message"] as const;

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

export type AuthSessionSource = {
	readonly listen: (listener: () => void) => () => void;
	readonly get: () => {
		readonly isPending: boolean;
		readonly data: null | {
			readonly user: {
				readonly id: string;
				readonly name: string;
				readonly email: string;
				readonly image?: string | null;
			};
		};
	};
};

export class AuthClientError extends Data.TaggedError("AuthClientError")<{
	readonly message: string;
}> {}

type AuthResponse<A> = {
	readonly data: A;
	readonly error: null | { readonly message?: string };
};

type SessionTokenStore = {
	readonly read: (origin: ServerOrigin) => string | null;
	readonly write: (origin: ServerOrigin, token: string) => void;
};

const createClient = (origin: ServerOrigin, tokens: SessionTokenStore) => {
	let challenge: string | undefined;
	return createAuthClient({
		baseURL: origin,
		plugins: [twoFactorClient(), oneTimeTokenClient()],
		fetchOptions: {
			credentials: "omit",
			onRequest: (context) => {
				const token = tokens.read(origin);
				if (token) {
					context.headers.set("Authorization", `Bearer ${token}`);
				}
				if (challenge) {
					context.headers.set(TWO_FACTOR_TOKEN_HEADER, challenge);
				}
			},
			onResponse: (context) => {
				const token = context.response.headers.get(SESSION_TOKEN_HEADER);
				if (token) {
					challenge = undefined;
					tokens.write(origin, token);
				}
				const issued = context.response.headers.get(SET_TWO_FACTOR_TOKEN_HEADER);
				if (issued) {
					challenge = issued;
				}
			},
		},
	});
};

type BrowserAuthClient = ReturnType<typeof createClient>;

const request = <A>(operation: () => Promise<AuthResponse<A>>, fallback: string) =>
	Effect.tryPromise({
		catch: (cause) =>
			new AuthClientError({ message: cause instanceof Error ? cause.message : fallback }),
		try: operation,
	}).pipe(
		Effect.flatMap((response) =>
			response.error
				? Effect.fail(new AuthClientError({ message: response.error.message ?? fallback }))
				: Effect.succeed(response.data),
		),
	);

const toSessionSnapshot = (state: ReturnType<AuthSessionSource["get"]>): AuthSessionSnapshot => {
	if (state.isPending) {
		return { status: "pending" };
	}
	if (state.data === null) {
		return { status: "missing" };
	}
	return {
		status: "authenticated",
		user: {
			id: state.data.user.id,
			name: state.data.user.name,
			email: state.data.user.email,
			image: state.data.user.image ?? null,
		},
	};
};

export const makeAuthSessionStore = (source: AuthSessionSource): AuthSessionStore => {
	let sourceSnapshot = source.get();
	let snapshot = toSessionSnapshot(sourceSnapshot);
	return {
		subscribe: (listener) => source.listen(listener),
		getSnapshot: () => {
			const next = source.get();
			if (next !== sourceSnapshot) {
				sourceSnapshot = next;
				snapshot = toSessionSnapshot(next);
			}
			return snapshot;
		},
	};
};

export const settleSession = (store: AuthSessionStore) =>
	Effect.callback<SettledAuthSession>((resume) => {
		const settled = store.getSnapshot();
		if (settled.status !== "pending") {
			resume(Effect.succeed(settled));
			return undefined;
		}
		const unsubscribe = store.subscribe(() => {
			const snapshot = store.getSnapshot();
			if (snapshot.status !== "pending") {
				unsubscribe();
				resume(Effect.succeed(snapshot));
			}
		});
		return Effect.sync(unsubscribe);
	});

export class AuthClient extends Context.Service<
	AuthClient,
	{
		readonly clear: () => Effect.Effect<void>;
		readonly session: (origin: ServerOrigin) => AuthSessionStore;
		readonly signOut: (origin: ServerOrigin) => Effect.Effect<void, AuthClientError>;
		readonly settledSession: (origin: ServerOrigin) => Effect.Effect<SettledAuthSession>;
		readonly refreshSession: (origin: ServerOrigin) => Effect.Effect<void, AuthClientError>;
		readonly signIn: (
			origin: ServerOrigin,
			values: CredentialsValues,
		) => Effect.Effect<unknown, AuthClientError>;
		readonly signInWithOidc: (
			origin: ServerOrigin,
			callbackURL: string,
		) => Effect.Effect<void, AuthClientError>;
		readonly signUp: (
			origin: ServerOrigin,
			values: CredentialsValues & { readonly name: string },
		) => Effect.Effect<void, AuthClientError>;
		readonly verifyOneTimeToken: (
			origin: ServerOrigin,
			token: string,
		) => Effect.Effect<void, AuthClientError>;
		readonly verifyTwoFactor: (
			origin: ServerOrigin,
			method: TwoFactorMethod,
			code: string,
		) => Effect.Effect<void, AuthClientError>;
	}
>()("AuthClient", {
	make: Effect.gen(function* () {
		const storage = yield* ClientStorage;
		const stores = new Map<ServerOrigin, AuthSessionStore>();
		const clients = new Map<ServerOrigin, BrowserAuthClient>();
		const tokens: SessionTokenStore = {
			read: (origin) => Effect.runSync(storage.getSessionToken(origin)),
			write: (origin, token) => Effect.runSync(storage.setSessionToken(origin, token)),
		};
		const getClient = (origin: ServerOrigin) => {
			const canonical = normalizeServerOrigin(origin);
			const existing = clients.get(canonical);
			if (existing) {
				return existing;
			}
			const client = createClient(canonical, tokens);
			clients.set(canonical, client);
			return client;
		};
		const session = (origin: ServerOrigin) => {
			const canonical = normalizeServerOrigin(origin);
			const existing = stores.get(canonical);
			if (existing) {
				return existing;
			}
			const source = getClient(canonical).useSession;
			const store = makeAuthSessionStore(source);
			stores.set(canonical, store);
			return store;
		};
		const clear = Effect.fn("AuthClient.clear")(function* () {
			yield* storage.remove(BETTER_AUTH_STORAGE_KEYS);
			yield* Effect.forEach([...clients.keys()], storage.clearSessionToken);
			clients.clear();
			stores.clear();
		});
		const signIn = (origin: ServerOrigin, values: CredentialsValues) =>
			request(() => getClient(origin).signIn.email(values), "Could not sign in.");
		const signUp = (origin: ServerOrigin, values: CredentialsValues & { readonly name: string }) =>
			request(() => getClient(origin).signUp.email(values), "Could not create your account.").pipe(
				Effect.asVoid,
			);
		const signInWithOidc = (origin: ServerOrigin, callbackURL: string) =>
			request(
				() => getClient(origin).signIn.social({ callbackURL, provider: "oidc" }),
				"Could not open the identity provider.",
			).pipe(Effect.asVoid);
		const signOut = (origin: ServerOrigin) =>
			request(() => getClient(origin).signOut(), "Could not sign out.").pipe(Effect.asVoid);
		const refreshSession = (origin: ServerOrigin) =>
			Effect.tryPromise({
				catch: (cause) =>
					new AuthClientError({
						message: cause instanceof Error ? cause.message : "Could not refresh the session.",
					}),
				try: () => getClient(origin).useSession.get().refetch(),
			});
		const verifyOneTimeToken = (origin: ServerOrigin, token: string) =>
			request(
				() => getClient(origin).oneTimeToken.verify({ token }),
				"Could not complete sign-in.",
			).pipe(Effect.asVoid);
		const verifyTwoFactor = (origin: ServerOrigin, method: TwoFactorMethod, code: string) =>
			request(
				() =>
					method === "backupCode"
						? getClient(origin).twoFactor.verifyBackupCode({ code })
						: getClient(origin).twoFactor.verifyTotp({ code }),
				"Could not verify that code.",
			).pipe(Effect.asVoid);

		const settledSession = (origin: ServerOrigin) => settleSession(session(origin));

		return {
			clear,
			signIn,
			signUp,
			session,
			signOut,
			refreshSession,
			settledSession,
			signInWithOidc,
			verifyTwoFactor,
			verifyOneTimeToken,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
