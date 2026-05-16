import { describe, expect, it } from "bun:test";

import { createEntityFixture, createEntitySavedViewFixture } from "~/features/test-fixtures";

import {
	createQueryEngineRequest,
	formatRuntimeValue,
	getRuntimeField,
	isRuntimeField,
} from "./view-page-utils";

describe("createQueryEngineRequest", () => {
	it("does not request hidden entityImage for table layouts", () => {
		const view = createEntitySavedViewFixture({
			queryDefinition: { scope: ["show"] },
		});

		const result = createQueryEngineRequest({
			view,
			page: 1,
			limit: 20,
			layout: "table",
		});

		expect(result.fields?.some((field) => field.key === "entityImage")).toBe(false);
	});

	it("preserves saved view relationshipJoins in runtime requests", () => {
		const view = createEntitySavedViewFixture({
			queryDefinition: {
				scope: ["show"],
				relationshipJoins: [
					{
						key: "inLibrary",
						kind: "latestRelationship",
						relationshipSchemaSlug: "in-library",
						direction: "outgoing",
						required: true,
					},
				],
			},
		});

		const result = createQueryEngineRequest({
			view,
			page: 2,
			limit: 12,
			layout: "grid",
		});

		expect(result.relationshipJoins).toEqual([
			{
				key: "inLibrary",
				kind: "latestRelationship",
				relationshipSchemaSlug: "in-library",
				direction: "outgoing",
				required: true,
			},
		]);
	});
});

describe("runtime field helpers", () => {
	it("reads runtime fields from the wrapped entity record", () => {
		const item = createEntityFixture({
			fields: {
				title: { kind: "text", value: "Dune" },
				image: { kind: "image", value: { type: "remote", url: "https://example.com/dune.png" } },
			},
		});

		expect(getRuntimeField(item, "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Dune",
		});
		expect(getRuntimeField(item, "missing")).toBeUndefined();
	});

	it("reads runtime fields from a raw query-engine record", () => {
		const item = {
			fields: { kind: "text", value: "should not win" },
			title: { kind: "text", value: "Dune" },
		} as const;

		expect(getRuntimeField(item, "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Dune",
		});
	});

	it("distinguishes runtime fields from plain values", () => {
		expect(isRuntimeField({ key: "count", kind: "number", value: 12 })).toBe(true);
		expect(isRuntimeField({ value: 12 })).toBe(false);
		expect(isRuntimeField(null)).toBe(false);
	});

	it("formats runtime values for display", () => {
		expect(formatRuntimeValue("")).toBe("-");
		expect(formatRuntimeValue(false)).toBe("No");
		expect(formatRuntimeValue({ foo: "bar" })).toBe('{"foo":"bar"}');
	});
});
