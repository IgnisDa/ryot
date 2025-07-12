import { describe, expect, it } from "bun:test";
import {
	getComparablePropertyType,
	getPropertyDisplayKind,
	supportsComparableFilter,
	supportsContainsFilter,
} from "./policy";

describe("view policy", () => {
	it("identifies comparable property types consistently", () => {
		expect(getComparablePropertyType({ type: "string" })).toBe("string");
		expect(getComparablePropertyType({ type: "datetime" })).toBe("datetime");
		expect(getComparablePropertyType({ type: "array" })).toBeUndefined();
		expect(supportsComparableFilter("integer")).toBe(true);
		expect(supportsComparableFilter("object")).toBe(false);
	});

	it("identifies contains support consistently", () => {
		expect(supportsContainsFilter("string")).toBe(true);
		expect(supportsContainsFilter("array")).toBe(true);
		expect(supportsContainsFilter("number")).toBe(false);
	});

	it("maps property types to display kinds consistently", () => {
		expect(getPropertyDisplayKind("datetime")).toBe("date");
		expect(getPropertyDisplayKind("number")).toBe("number");
		expect(getPropertyDisplayKind("object")).toBe("json");
		expect(getPropertyDisplayKind("string")).toBe("text");
	});
});
