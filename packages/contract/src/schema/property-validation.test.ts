import { describe, expect, it } from "bun:test";

import { formatPropertyIssues } from "./property-validation";

describe("formatPropertyIssues", () => {
	it("formats a single issue without a path prefix", () => {
		const formatted = formatPropertyIssues([{ path: [], message: "required" }]);
		expect(formatted).toBe("required");
	});

	it("prefixes issues that have a path", () => {
		const formatted = formatPropertyIssues([{ message: "too short", path: ["meta", "title"] }]);
		expect(formatted).toBe("meta.title: too short");
	});

	it("joins multiple issues with a semicolon", () => {
		const formatted = formatPropertyIssues([
			{ path: [], message: "first error" },
			{ path: ["field"], message: "second error" },
		]);
		expect(formatted).toBe("first error; field: second error");
	});
});
