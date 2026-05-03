import { describe, expect, it } from "bun:test";
import { parseFieldPath } from "~/fixtures";

describe("parseFieldPath", () => {
	it("parses entity built-in column references (3 segments, no @)", () => {
		expect(parseFieldPath("entity.smartphones.id")).toEqual({
			path: ["id"],
			type: "entity",
			slug: "smartphones",
		});

		expect(parseFieldPath("entity.smartphones.sandboxScriptId")).toEqual({
			type: "entity",
			slug: "smartphones",
			path: ["sandboxScriptId"],
		});
	});

	it("parses entity schema property references (properties keyword)", () => {
		expect(parseFieldPath("entity.smartphones.properties.year")).toEqual({
			type: "entity",
			slug: "smartphones",
			path: ["properties", "year"],
		});
	});

	it("parses deep entity schema property references", () => {
		expect(
			parseFieldPath("entity.smartphones.properties.metadata.source"),
		).toEqual({
			type: "entity",
			slug: "smartphones",
			path: ["properties", "metadata", "source"],
		});
	});

	it("parses event column references (3 segments, no @)", () => {
		expect(parseFieldPath("event.review.createdAt")).toEqual({
			joinKey: "review",
			type: "event-join",
			path: ["createdAt"],
		});
	});

	it("parses event schema property references (properties keyword)", () => {
		expect(parseFieldPath("event.review.properties.rating")).toEqual({
			joinKey: "review",
			type: "event-join",
			path: ["properties", "rating"],
		});
	});

	it("parses computed field references", () => {
		expect(parseFieldPath("computed.myField")).toEqual({
			key: "myField",
			type: "computed-field",
		});
	});

	it("rejects old @-prefixed entity column syntax", () => {
		expect(() => parseFieldPath("entity.smartphones.@id")).toThrow(
			"Invalid field path: entity.smartphones.@id",
		);
		expect(() => parseFieldPath("entity.smartphones.@sandboxScriptId")).toThrow(
			"Invalid field path: entity.smartphones.@sandboxScriptId",
		);
	});

	it("rejects bare entity schema property (old syntax, 3 segments without properties keyword)", () => {
		expect(() => parseFieldPath("entity.smartphones.author")).toThrow(
			"Invalid field path: entity.smartphones.author",
		);
	});

	it("rejects old @-prefixed event column syntax", () => {
		expect(() => parseFieldPath("event.review.@createdAt")).toThrow(
			"Invalid field path: event.review.@createdAt",
		);
	});

	it("rejects bare event property (old syntax without properties keyword)", () => {
		expect(() => parseFieldPath("event.review.rating")).toThrow(
			"Invalid field path: event.review.rating",
		);
	});

	it("rejects properties keyword without at least one property segment", () => {
		expect(() => parseFieldPath("entity.smartphones.properties")).toThrow(
			"Invalid field path: entity.smartphones.properties",
		);

		expect(() => parseFieldPath("event.review.properties")).toThrow(
			"Invalid field path: event.review.properties",
		);
	});

	it("rejects malformed field paths", () => {
		expect(() => parseFieldPath("@name")).toThrow("Invalid field path: @name");
		expect(() => parseFieldPath("year")).toThrow("Invalid field path: year");
		expect(() => parseFieldPath("smartphones.year")).toThrow(
			"Invalid field path: smartphones.year",
		);
		expect(() => parseFieldPath("event.review")).toThrow(
			"Invalid field path: event.review",
		);
	});
});
