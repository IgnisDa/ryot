import type { BetterAuthPlugin, Session, User } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";

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

export const runDemoSignIn = (operations: DemoSignInOperations) => {
	if (operations.demoAccountId === null) {
		return Promise.reject(
			APIError.from("FORBIDDEN", { code: "DEMO_DISABLED", message: "Demo access is unavailable." }),
		);
	}
	const demoAccountId = operations.demoAccountId;

	return operations.findUserById(demoAccountId).then((user) => {
		if (!user || user.disabledAt) {
			throw APIError.from("FORBIDDEN", {
				code: "DEMO_ACCOUNT_UNAVAILABLE",
				message: "Demo access is unavailable.",
			});
		}

		const existing = operations.existingSession;
		if (existing?.accessClass !== "demo" && existing !== null) {
			return { mode: "standard" as const };
		}
		if (existing?.userId === demoAccountId) {
			return { mode: "demo" as const };
		}
		const deleteExisting = existing
			? operations.deleteSession(existing.token).then(() => operations.deleteCookie())
			: Promise.resolve();
		return deleteExisting
			.then(() => operations.createSession(demoAccountId, "demo"))
			.then((session) =>
				operations.setCookie(session, user).then(() => ({ mode: "demo" as const })),
			);
	});
};

export const demoAccessPlugin = (demoAccountId: string | null): BetterAuthPlugin => ({
	id: "demo-access",
	endpoints: {
		signInDemo: createAuthEndpoint("/demo/sign-in", { method: "POST" }, (ctx) =>
			getSessionFromCtx<DemoUser, DemoSession>(ctx, {
				disableRefresh: true,
				disableCookieCache: true,
			}).then((existing) =>
				runDemoSignIn({
					demoAccountId,
					existingSession: existing?.session ?? null,
					deleteCookie: () => deleteSessionCookie(ctx),
					setCookie: (session, user) => setSessionCookie(ctx, { user, session }),
					findUserById: (userId) => ctx.context.internalAdapter.findUserById(userId),
					deleteSession: (token) => ctx.context.internalAdapter.deleteSession(token),
					createSession: (userId, accessClass) =>
						ctx.context.internalAdapter.createSession(userId, false, { accessClass }, true),
				}).then((result) => ctx.json(result)),
			),
		),
	},
});
