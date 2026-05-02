import { describe, expect, it } from "bun:test";

import { checkAccess, checkCustomAccess, checkReadAccess } from "./index";
import type { ResourceScope } from "./types";

const createTestScope = (overrides?: Partial<ResourceScope>): ResourceScope => ({
	id: "test-id",
	userId: "user-1",
	isBuiltin: false,
	...overrides,
});

describe("checkAccess", () => {
	describe("existence check", () => {
		it("returns not_found error when scope is undefined", () => {
			const result = checkAccess({ scope: undefined });

			expect(result).toEqual({
				error: "not_found",
				message: "Resource not found",
			});
		});

		it("returns not_found with custom message when provided", () => {
			const result = checkAccess({
				scope: undefined,
				messages: { not_found: "Custom not found message" },
			});

			expect(result).toEqual({
				error: "not_found",
				message: "Custom not found message",
			});
		});

		it("returns data when scope exists", () => {
			const scope = createTestScope();
			const result = checkAccess({ scope });

			expect(result).toEqual({ data: scope });
		});
	});

	describe("custom rules", () => {
		it("evaluates rules sequentially", () => {
			const scope = createTestScope();
			const rule1 = {
				test: () => true,
				message: "Rule 1",
				error: "forbidden" as const,
			};
			const rule2 = {
				test: () => false,
				message: "Rule 2",
				error: "forbidden" as const,
			};

			const result = checkAccess({ scope, rules: [rule1, rule2] });

			expect(result).toEqual({ error: "forbidden", message: "Rule 2" });
		});

		it("returns first failing rule error", () => {
			const scope = createTestScope();
			const rule1 = {
				test: () => false,
				message: "First failure",
				error: "forbidden" as const,
			};
			const rule2 = {
				test: () => false,
				message: "Second failure",
				error: "forbidden" as const,
			};

			const result = checkAccess({ scope, rules: [rule1, rule2] });

			expect(result).toEqual({ error: "forbidden", message: "First failure" });
		});

		it("returns data when all rules pass", () => {
			const scope = createTestScope();
			const rule1 = {
				test: () => true,
				message: "Rule 1",
				error: "forbidden" as const,
			};
			const rule2 = {
				test: () => true,
				message: "Rule 2",
				error: "forbidden" as const,
			};

			const result = checkAccess({ scope, rules: [rule1, rule2] });

			expect(result).toEqual({ data: scope });
		});

		it("short-circuits on first failure", () => {
			const scope = createTestScope();
			let rule2Called = false;
			const rule1 = {
				test: () => false,
				message: "First failure",
				error: "forbidden" as const,
			};
			const rule2 = {
				message: "Second failure",
				error: "forbidden" as const,
				test: () => {
					rule2Called = true;
					return false;
				},
			};

			checkAccess({ scope, rules: [rule1, rule2] });
			expect(rule2Called).toBe(false);
		});

		it("rules are not affected by the messages override", () => {
			const scope = createTestScope();
			const rule = {
				test: () => false,
				message: "Rule-level message",
				error: "not_found" as const,
			};

			const result = checkAccess({
				scope,
				rules: [rule],
				messages: { not_found: "Top-level message" },
			});

			expect(result).toEqual({
				error: "not_found",
				message: "Rule-level message",
			});
		});
	});

	describe("type narrowing", () => {
		it("narrows data type on success", () => {
			const scope = createTestScope();
			const result = checkAccess({ scope });

			if ("data" in result) {
				expect(result.data.id).toBe("test-id");
				expect(result.data.userId).toBe("user-1");
				expect(result.data.isBuiltin).toBe(false);
			} else {
				throw new Error("Expected data, got error");
			}
		});

		it("narrows error type on failure", () => {
			const result = checkAccess({ scope: undefined });

			if ("error" in result) {
				expect(result.error).toBe("not_found");
				expect(result.message).toBe("Resource not found");
			} else {
				throw new Error("Expected error, got data");
			}
		});
	});
});

describe("checkReadAccess", () => {
	it("returns not_found when scope is undefined", () => {
		const result = checkReadAccess(undefined);

		expect(result).toEqual({
			error: "not_found",
			message: "Resource not found",
		});
	});

	it("returns data when scope exists", () => {
		const scope = createTestScope();
		const result = checkReadAccess(scope);

		expect(result).toEqual({ data: scope });
	});

	it("allows custom messages", () => {
		const result = checkReadAccess(undefined, {
			not_found: "Entity not found",
		});

		expect(result).toEqual({
			error: "not_found",
			message: "Entity not found",
		});
	});
});

describe("checkCustomAccess", () => {
	it("returns not_found when scope is undefined", () => {
		const result = checkCustomAccess(undefined);

		expect(result).toEqual({
			error: "not_found",
			message: "Resource not found",
		});
	});

	it("returns builtin_resource when scope is builtin", () => {
		const scope = createTestScope({ isBuiltin: true });
		const result = checkCustomAccess(scope);

		expect(result).toEqual({
			error: "builtin_resource",
			message: "Built-in resources do not support this operation",
		});
	});

	it("returns data when scope is custom", () => {
		const scope = createTestScope({ isBuiltin: false });
		const result = checkCustomAccess(scope);

		expect(result).toEqual({ data: scope });
	});

	it("allows custom messages", () => {
		const builtinScope = createTestScope({ isBuiltin: true });
		const result = checkCustomAccess(builtinScope, {
			builtin_resource: "Custom entities only",
			not_found: "Entity not found",
		});

		expect(result).toEqual({
			error: "builtin_resource",
			message: "Custom entities only",
		});
	});

	it("checks existence before the builtin check", () => {
		const result = checkCustomAccess(undefined);

		expect(result).toEqual({
			error: "not_found",
			message: "Resource not found",
		});
	});
});
