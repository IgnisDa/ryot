import { describe, expect, it } from "bun:test";

import { Option, Schema } from "@ryot-app/plugin-kit/effect";

import { ConsumedOn, consumedOnLabel, mergeConsumedOn } from "./consumed-on";
import { CONSUMED_ON_SOURCES_LIMIT } from "./consumed-on-settings";

const decode = (value: unknown) =>
	Option.getOrUndefined(Schema.decodeUnknownOption(ConsumedOn)(value));

describe("ConsumedOn", () => {
	it("trims sources and keeps their order", () => {
		expect(decode([" Netflix ", "Plex"])).toEqual(["Netflix", "Plex"]);
	});

	it("rejects empty lists, blank or long sources, duplicates ignoring case, and over ten sources", () => {
		expect(decode([])).toBeUndefined();
		expect(decode(["  "])).toBeUndefined();
		expect(decode(["x".repeat(101)])).toBeUndefined();
		expect(decode(["x".repeat(100)])).toHaveLength(1);
		expect(decode(["Plex", " plex "])).toBeUndefined();
		expect(decode(Array.from({ length: 11 }, (_, index) => `Source ${index}`))).toBeUndefined();
		expect(decode(Array.from({ length: 10 }, (_, index) => `Source ${index}`))).toHaveLength(10);
	});

	it("rejects a bare string", () => {
		expect(decode("Plex")).toBeUndefined();
	});
});

describe("mergeConsumedOn", () => {
	it("unions lists in first-seen order, ignoring case", () => {
		expect(mergeConsumedOn(["Plex", "Netflix"], [], ["netflix", "Kindle"])).toEqual([
			"Plex",
			"Netflix",
			"Kindle",
		]);
	});
});

describe("mergeConsumedOn limit", () => {
	it("caps the union at the sources limit", () => {
		const merged = mergeConsumedOn(
			Array.from({ length: 8 }, (_, index) => `A ${index}`),
			Array.from({ length: 8 }, (_, index) => `B ${index}`),
		);
		expect(merged).toHaveLength(CONSUMED_ON_SOURCES_LIMIT);
		expect(merged.at(-1)).toBe("B 1");
	});
});

describe("consumedOnLabel", () => {
	it("joins sources and is undefined without any", () => {
		expect(consumedOnLabel(["Plex", "Netflix"])).toBe("Plex, Netflix");
		expect(consumedOnLabel([])).toBeUndefined();
		expect(consumedOnLabel(null)).toBeUndefined();
	});
});
