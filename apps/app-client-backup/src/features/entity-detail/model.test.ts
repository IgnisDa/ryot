import { describe, expect, it } from "bun:test";

import { EntityId, EntitySchemaId } from "@ryot/contract/schema/brands";
import type { BookProperties } from "@ryot/contract/schema/media-types";

import { isEntitySchemaSlug, toEntityDetail } from "./model";

type EntityInput = Parameters<typeof toEntityDetail>[0];

function makeEntity(properties: Record<string, unknown>): EntityInput {
	return {
		properties,
		externalId: null,
		name: "Example Title",
		sandboxScriptId: null,
		id: EntityId.make("entity-1"),
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-02T00:00:00.000Z",
		populatedAt: "2024-01-03T00:00:00.000Z",
		entitySchemaId: EntitySchemaId.make("schema-1"),
		image: { type: "remote", url: "https://example.com/cover.jpg" },
	};
}

describe("entity-detail model", () => {
	it("recognizes supported entity schema slugs", () => {
		expect(isEntitySchemaSlug("book")).toBeTrue();
		expect(isEntitySchemaSlug("movie")).toBeTrue();
		expect(isEntitySchemaSlug("unsupported")).toBeFalse();
	});

	it("keeps the backend entity payload intact when tagging the schema slug", () => {
		const properties: BookProperties = {
			pages: 662,
			isNsfw: true,
			publishYear: 2007,
			genres: ["Fantasy"],
			providerRating: 9.1,
			isCompilation: false,
			description: "A description.",
			productionStatus: "Published",
			sourceUrl: "https://example.com/book",
			unlinkedCreators: [{ name: "Patrick Rothfuss", role: "Author" }],
			images: [{ type: "remote", url: "https://example.com/book.jpg" }],
		};
		const detail = toEntityDetail(makeEntity(properties), "book");

		expect(detail.entitySchemaSlug).toBe("book");
		expect(detail.image).toEqual({ type: "remote", url: "https://example.com/cover.jpg" });
		expect(detail.properties).toEqual(properties);
	});

	it("throws when the backend payload does not match the slug's expected schema", () => {
		const malformedProperties = { pages: "not-a-number" };

		expect(() => toEntityDetail(makeEntity(malformedProperties), "book")).toThrow();
	});
});
