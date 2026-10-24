import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { AdminApiError } from "#/api/admin";
import { isUnauthorizedCause, withAdminAuthorization } from "#/modules/instance-admin/errors";

describe("isUnauthorizedCause", () => {
	it("recognizes a typed unauthorized failure", () => {
		expect(
			isUnauthorizedCause(
				Cause.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
			),
		).toBe(true);
	});

	it("recognizes an unauthorized failure wrapped by AdminApi", () => {
		expect(
			isUnauthorizedCause(
				Cause.fail(
					new AdminApiError({
						cause: new AuthUnauthorized({ reason: { code: "admin-access-required" } }),
					}),
				),
			),
		).toBe(true);
	});

	it("rejects unrelated failures and defects", () => {
		expect(isUnauthorizedCause(Cause.fail(new Error("network")))).toBe(false);
		expect(isUnauthorizedCause(Cause.die(new Error("defect")))).toBe(false);
	});
});

describe("withAdminAuthorization", () => {
	it("returns an ordinary successful value without relocking", () => {
		const calls: string[] = [];
		expect(
			Effect.runSync(
				withAdminAuthorization(Effect.succeed("result"), () => calls.push("unauthorized")),
			),
		).toBe("result");
		expect(calls).toEqual([]);
	});

	it("relocks for unauthorized while retaining the original failure cause", () => {
		const calls: string[] = [];
		const cause = Cause.fail(
			new AdminApiError({
				cause: new AuthUnauthorized({ reason: { code: "admin-access-required" } }),
			}),
		);
		const result = Effect.runSyncExit(
			withAdminAuthorization(Effect.failCause(cause), () => calls.push("unauthorized")),
		);
		expect(result).toEqual(Exit.failCause(cause));
		expect(calls).toEqual(["unauthorized"]);
	});

	it("retains defects without relocking", () => {
		const calls: string[] = [];
		const cause = Cause.die(new Error("defect"));
		expect(
			Effect.runSyncExit(
				withAdminAuthorization(Effect.failCause(cause), () => calls.push("unauthorized")),
			),
		).toEqual(Exit.failCause(cause));
		expect(calls).toEqual([]);
	});

	it("retains interruption without relocking", () => {
		const calls: string[] = [];
		const result = Effect.runSyncExit(
			withAdminAuthorization(Effect.interrupt, () => calls.push("unauthorized")),
		);
		expect(Exit.hasInterrupts(result)).toBe(true);
		expect(calls).toEqual([]);
	});
});
