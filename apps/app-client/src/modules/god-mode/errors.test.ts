import { Unauthorized } from "@ryot/contract/errors";
import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import { isUnauthorizedCause } from "./errors";

describe("isUnauthorizedCause", () => {
	it("recognizes a typed unauthorized failure", () => {
		expect(isUnauthorizedCause(Cause.fail(new Unauthorized({ message: "Unauthorized" })))).toBe(
			true,
		);
	});

	it("rejects unrelated failures and defects", () => {
		expect(isUnauthorizedCause(Cause.fail(new Error("network")))).toBe(false);
		expect(isUnauthorizedCause(Cause.die(new Error("defect")))).toBe(false);
	});
});
