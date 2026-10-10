import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import { AdminApiError } from "#/api/admin";
import { isUnauthorizedCause } from "#/modules/god-mode/errors";

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
