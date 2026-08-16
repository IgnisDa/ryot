import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import { isUnauthorizedCause } from "./errors";

describe("isUnauthorizedCause", () => {
	it("recognizes a typed unauthorized failure", () => {
		expect(
			isUnauthorizedCause(
				Cause.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
			),
		).toBe(true);
	});

	it("rejects unrelated failures and defects", () => {
		expect(isUnauthorizedCause(Cause.fail(new Error("network")))).toBe(false);
		expect(isUnauthorizedCause(Cause.die(new Error("defect")))).toBe(false);
	});
});
