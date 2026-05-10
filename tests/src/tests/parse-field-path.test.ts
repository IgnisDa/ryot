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
		expect(parseFieldPath("entity.smartphones.properties.metadata.source")).toEqual({
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
		expect(() => parseFieldPath("event.review")).toThrow("Invalid field path: event.review");
	});

	describe("relationship namespace", () => {
		it("parses a relationship join built-in column", () => {
			expect(parseFieldPath("relationship.myJoin.createdAt")).toEqual({
				joinKey: "myJoin",
				path: ["createdAt"],
				type: "relationship-join",
			});
		});

		it("parses all four built-in columns", () => {
			expect(parseFieldPath("relationship.myJoin.id")).toEqual({
				path: ["id"],
				joinKey: "myJoin",
				type: "relationship-join",
			});
			expect(parseFieldPath("relationship.myJoin.createdAt")).toEqual({
				joinKey: "myJoin",
				path: ["createdAt"],
				type: "relationship-join",
			});
			expect(parseFieldPath("relationship.myJoin.sourceEntityId")).toEqual({
				joinKey: "myJoin",
				path: ["sourceEntityId"],
				type: "relationship-join",
			});
			expect(parseFieldPath("relationship.myJoin.targetEntityId")).toEqual({
				joinKey: "myJoin",
				path: ["targetEntityId"],
				type: "relationship-join",
			});
		});

		it("parses a relationship property path", () => {
			expect(parseFieldPath("relationship.myJoin.properties.rating")).toEqual({
				joinKey: "myJoin",
				type: "relationship-join",
				path: ["properties", "rating"],
			});
		});

		it("parses a deep relationship property path", () => {
			expect(parseFieldPath("relationship.myJoin.properties.meta.source")).toEqual({
				joinKey: "myJoin",
				type: "relationship-join",
				path: ["properties", "meta", "source"],
			});
		});

		it("parses a sourceEntity built-in column", () => {
			expect(parseFieldPath("relationship.myJoin.sourceEntity.name")).toEqual({
				joinKey: "myJoin",
				type: "relationship-join",
				path: ["sourceEntity", "name"],
			});
		});

		it("parses a targetEntity built-in column", () => {
			expect(parseFieldPath("relationship.myJoin.targetEntity.id")).toEqual({
				joinKey: "myJoin",
				type: "relationship-join",
				path: ["targetEntity", "id"],
			});
		});

		it("parses a sourceEntity property path", () => {
			expect(parseFieldPath("relationship.myJoin.sourceEntity.properties.year")).toEqual({
				joinKey: "myJoin",
				type: "relationship-join",
				path: ["sourceEntity", "properties", "year"],
			});
		});

		it("parses a deep targetEntity property path", () => {
			expect(parseFieldPath("relationship.myJoin.targetEntity.properties.meta.source")).toEqual({
				joinKey: "myJoin",
				type: "relationship-join",
				path: ["targetEntity", "properties", "meta", "source"],
			});
		});

		it("rejects relationship.myJoin (missing tail segment)", () => {
			expect(() => parseFieldPath("relationship.myJoin")).toThrow(
				"Invalid field path: relationship.myJoin",
			);
		});

		it("rejects relationship.myJoin.properties (properties without property segment)", () => {
			expect(() => parseFieldPath("relationship.myJoin.properties")).toThrow(
				"Invalid field path: relationship.myJoin.properties",
			);
		});

		it("rejects relationship.myJoin.sourceEntity (entity side without column)", () => {
			expect(() => parseFieldPath("relationship.myJoin.sourceEntity")).toThrow(
				"Invalid field path: relationship.myJoin.sourceEntity",
			);
		});

		it("rejects relationship.myJoin.sourceEntity.properties (entity properties without property segment)", () => {
			expect(() => parseFieldPath("relationship.myJoin.sourceEntity.properties")).toThrow(
				"Invalid field path: relationship.myJoin.sourceEntity.properties",
			);
		});

		it("rejects relationship.myJoin.unknownColumn (not a valid builtin)", () => {
			expect(() => parseFieldPath("relationship.myJoin.unknownColumn")).toThrow(
				"Invalid field path: relationship.myJoin.unknownColumn",
			);
		});

		it("rejects relationship.myJoin.sourceEntity.unknownColumn (not a valid entity builtin)", () => {
			expect(() => parseFieldPath("relationship.myJoin.sourceEntity.unknownColumn")).toThrow(
				"Invalid field path: relationship.myJoin.sourceEntity.unknownColumn",
			);
		});
	});
});
