import { describe, expect, it } from "bun:test";
import { sanitizeIdentifier } from "./sql-expression-helpers";

describe("sanitizeIdentifier", () => {
	it("allows valid alphanumeric identifiers", () => {
		expect(sanitizeIdentifier("base_entities", "CTE name")).toBe(
			"base_entities",
		);
		expect(sanitizeIdentifier("filtered_entities", "CTE name")).toBe(
			"filtered_entities",
		);
		expect(sanitizeIdentifier("id", "column name")).toBe("id");
		expect(sanitizeIdentifier("entity_schema_data", "column name")).toBe(
			"entity_schema_data",
		);
	});

	it("allows identifiers starting with underscore", () => {
		expect(sanitizeIdentifier("_temp", "identifier")).toBe("_temp");
	});

	it("allows identifiers with numbers after the first character", () => {
		expect(sanitizeIdentifier("col1", "identifier")).toBe("col1");
		expect(sanitizeIdentifier("table_2", "identifier")).toBe("table_2");
	});

	it("rejects identifiers with spaces", () => {
		expect(() => sanitizeIdentifier("hello world", "identifier")).toThrow(
			"Invalid SQL identifier",
		);
	});

	it("rejects identifiers with hyphens", () => {
		expect(() => sanitizeIdentifier("hello-world", "identifier")).toThrow(
			"Invalid SQL identifier",
		);
	});

	it("rejects identifiers starting with a number", () => {
		expect(() => sanitizeIdentifier("1table", "identifier")).toThrow(
			"Invalid SQL identifier",
		);
	});

	it("rejects empty identifiers", () => {
		expect(() => sanitizeIdentifier("", "identifier")).toThrow(
			"Invalid SQL identifier",
		);
	});

	it("includes the label in the error message", () => {
		expect(() => sanitizeIdentifier("bad id", "CTE name")).toThrow(
			"Invalid SQL CTE name",
		);
	});
});
