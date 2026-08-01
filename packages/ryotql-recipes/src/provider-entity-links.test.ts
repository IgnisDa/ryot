import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { providerEntityLinksRecipe } from "./provider-entity-links";
import { rowsResponse } from "./test-utils";

const pageInfo = { limit: 2, hasMore: false, nextCursor: null };
const recipe = providerEntityLinksRecipe({
	librarySchemaSlug: "media-library",
	relationshipSlug: "in-media-library",
	externalIds: ["external-1", "external-2"],
	entitySchemaSlug: EntitySchemaSlug.make("book"),
	providerId: SandboxProviderId.make("provider-1"),
});
const responseWithItems = (items: readonly unknown[]) => rowsResponse("links", items, pageInfo);

describe("provider entity links recipe", () => {
	it("prepares the provider-scoped lookup and decodes external ids", () => {
		const query = recipe.document.queries.links;
		assert(query);
		assert(query.output.type === "rows");

		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.output.fields).toMatchObject([{ key: "entityId" }, { key: "externalId" }]);
		expect(query.where).toMatchObject({
			type: "and",
			predicates: [
				{ right: { value: "book" } },
				{ right: { value: "provider-1" } },
				{ values: [{ value: "external-1" }, { value: "external-2" }] },
				{ type: "exists" },
			],
		});
		expect(
			Result.getOrThrow(
				recipe.decode(
					responseWithItems([
						{ entityId: "entity-1", externalId: "external-1" },
						{ entityId: "entity-2", externalId: "external-2" },
					]),
				),
			),
		).toEqual([
			{ externalId: "external-1", entityId: EntityId.make("entity-1") },
			{ externalId: "external-2", entityId: EntityId.make("entity-2") },
		]);
	});

	it("rejects malformed fields and non-rows results", () => {
		expect(Result.isFailure(recipe.decode(responseWithItems([{ externalId: null }])))).toBe(true);
		expect(
			Result.isFailure(recipe.decode({ data: { links: { items: [], type: "aggregate" } } })),
		).toBe(true);
	});
});
