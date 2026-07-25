import { expect, it } from "@effect/vitest";

import { runDemoSignIn } from "./demo-access-plugin";

const now = new Date("2026-09-20T00:00:00.000Z");
const user = {
	image: null,
	name: "Demo",
	createdAt: now,
	updatedAt: now,
	id: "demo-user",
	disabledAt: null,
	emailVerified: true,
	email: "demo@example.com",
};
const session = (token: string, userId: string, accessClass: "standard" | "demo") => ({
	token,
	userId,
	id: token,
	accessClass,
	createdAt: now,
	updatedAt: now,
	expiresAt: new Date("2026-09-21T00:00:00.000Z"),
});

const makeOperations = (overrides: Record<string, unknown> = {}) => {
	const calls = { deleted: [] as string[], created: [] as unknown[], cookies: [] as unknown[] };
	return {
		calls,
		operations: {
			existingSession: null,
			demoAccountId: "demo-user",
			findUserById: () => Promise.resolve(user),
			deleteCookie: () => calls.cookies.push("deleted"),
			deleteSession: (token: string) => {
				calls.deleted.push(token);
				return Promise.resolve();
			},
			setCookie: (createdSession: unknown, targetUser: unknown) => {
				calls.cookies.push({ user: targetUser, session: createdSession });
				return Promise.resolve();
			},
			createSession: (userId: string, accessClass: "demo") => {
				calls.created.push({ userId, accessClass });
				return Promise.resolve(session("new-token", userId, accessClass));
			},
			...overrides,
		},
	};
};

it("rejects disabled, missing, and disabled-user demo configuration", () =>
	Promise.all(
		(
			[
				[{ demoAccountId: null }, "DEMO_DISABLED"],
				[{ findUserById: () => Promise.resolve(null) }, "DEMO_ACCOUNT_UNAVAILABLE"],
				[
					{ findUserById: () => Promise.resolve({ ...user, disabledAt: new Date() }) },
					"DEMO_ACCOUNT_UNAVAILABLE",
				],
			] satisfies ReadonlyArray<readonly [Record<string, unknown>, string]>
		).map(([overrides, code]) =>
			expect(runDemoSignIn(makeOperations(overrides).operations)).rejects.toMatchObject({
				status: "FORBIDDEN",
				body: { code, message: "Demo access is unavailable." },
			}),
		),
	));

it("creates a demo session for exactly the configured user", () => {
	const { calls, operations } = makeOperations();
	return runDemoSignIn(operations).then((result) => {
		expect(result).toEqual({ mode: "demo" });
		expect(calls.created).toEqual([{ userId: "demo-user", accessClass: "demo" }]);
		expect(calls.cookies).toEqual([{ user, session: session("new-token", "demo-user", "demo") }]);
		return result;
	});
});

it("reuses a matching demo session", () => {
	const { calls, operations } = makeOperations({
		existingSession: session("current", "demo-user", "demo"),
	});
	return runDemoSignIn(operations).then((result) => {
		expect(result).toEqual({ mode: "demo" });
		expect(calls).toEqual({ created: [], deleted: [], cookies: [] });
		return result;
	});
});

it("replaces a stale demo session but preserves a standard session", () => {
	const stale = makeOperations({ existingSession: session("stale", "old-demo-user", "demo") });
	return runDemoSignIn(stale.operations).then((staleResult) => {
		expect(staleResult).toEqual({ mode: "demo" });
		expect(stale.calls.deleted).toEqual(["stale"]);
		expect(stale.calls.created).toEqual([{ userId: "demo-user", accessClass: "demo" }]);

		const standard = makeOperations({
			existingSession: session("owner", "owner-user", "standard"),
		});
		return runDemoSignIn(standard.operations).then((standardResult) => {
			expect(standardResult).toEqual({ mode: "standard" });
			expect(standard.calls).toEqual({ created: [], deleted: [], cookies: [] });
			return standardResult;
		});
	});
});
