import type { BetterAuthPlugin, Session, User } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";

type DemoSession = Session & { readonly accessClass?: unknown } & Record<string, unknown>;

type DemoUser = User & { readonly disabledAt?: Date | null } & Record<string, unknown>;

type DemoSignInOperations = {
	readonly demoAccountId: string | null;
	readonly existingSession: DemoSession | null;
	readonly findUserById: (userId: string) => Promise<DemoUser | null>;
	readonly createSession: (userId: string, accessClass: "demo") => Promise<DemoSession>;
	readonly deleteSession: (token: string) => Promise<void>;
	readonly deleteCookie: () => void;
	readonly setCookie: (session: DemoSession, user: DemoUser) => Promise<void>;
};

export const runDemoSignIn = Effect.fn("runDemoSignIn")(function* (
	operations: DemoSignInOperations,
) {
	if (operations.demoAccountId === null) {
		return yield* Effect.fail(
			APIError.from("FORBIDDEN", { code: "DEMO_DISABLED", message: "Demo access is unavailable." }),
		);
	}
	const demoAccountId = operations.demoAccountId;

	const user = yield* Effect.promise(() => operations.findUserById(demoAccountId));
	if (!user || user.disabledAt) {
		return yield* Effect.fail(
			APIError.from("FORBIDDEN", {
				code: "DEMO_ACCOUNT_UNAVAILABLE",
				message: "Demo access is unavailable.",
			}),
		);
	}

	const existing = operations.existingSession;
	if (existing?.accessClass !== "demo" && existing !== null) {
		return { mode: "standard" as const };
	}
	if (existing?.userId === demoAccountId) {
		return { mode: "demo" as const };
	}
	if (existing) {
		yield* Effect.promise(() => operations.deleteSession(existing.token));
		operations.deleteCookie();
	}
	const session = yield* Effect.promise(() => operations.createSession(demoAccountId, "demo"));
	yield* Effect.promise(() => operations.setCookie(session, user));
	return { mode: "demo" as const };
});

export const demoAccessPlugin = (demoAccountId: string | null): BetterAuthPlugin => ({
	id: "demo-access",
	endpoints: {
		signInDemo: createAuthEndpoint(
			"/demo/sign-in",
			{ method: "POST" },
			// oxlint-disable-next-line effecttsgo/async-function -- better-auth endpoint handlers are Promise-native and must return ctx.json's value directly; it is typed as a Promise but is a plain object at runtime.
			async (ctx) => {
				const result = await Effect.runPromise(
					Effect.gen(function* () {
						const existing = yield* Effect.promise(() =>
							getSessionFromCtx<DemoUser, DemoSession>(ctx, {
								disableRefresh: true,
								disableCookieCache: true,
							}),
						);
						return yield* runDemoSignIn({
							demoAccountId,
							existingSession: existing?.session ?? null,
							deleteCookie: () => deleteSessionCookie(ctx),
							setCookie: (session, user) => setSessionCookie(ctx, { user, session }),
							findUserById: (userId) => ctx.context.internalAdapter.findUserById(userId),
							deleteSession: (token) => ctx.context.internalAdapter.deleteSession(token),
							createSession: (userId, accessClass) =>
								ctx.context.internalAdapter.createSession(userId, false, { accessClass }, true),
						});
					}),
				);
				return ctx.json(result);
			},
		),
	},
});
