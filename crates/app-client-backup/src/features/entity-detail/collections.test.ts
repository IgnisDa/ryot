import { describe, expect, it } from "bun:test";

import { loadRelatedCollections } from "./collections";
import type {
	QueryEngineClient,
	QueryEngineEntitiesRequestBody,
	QueryEngineEntitiesResponse,
} from "./query-engine";

describe("loadRelatedCollections", () => {
	it("pages through all related collections", async () => {
		const calls: QueryEngineEntitiesRequestBody[] = [];
		const pageResponses: Record<number, QueryEngineEntitiesResponse> = {
			1: {
				mode: "entities",
				data: {
					items: [
						{
							collectionName: { kind: "text", value: "Reading" },
							collectionId: { kind: "text", value: "collection-1" },
						},
					],
					meta: {
						fieldOrder: ["collectionName"],
						pagination: {
							page: 1,
							total: 2,
							limit: 100,
							totalPages: 2,
							hasNextPage: true,
							hasPreviousPage: false,
						},
					},
				},
			},
			2: {
				mode: "entities",
				data: {
					items: [
						{
							collectionName: { kind: "text", value: "Favorites" },
							collectionId: { kind: "text", value: "collection-2" },
						},
					],
					meta: {
						fieldOrder: ["collectionName"],
						pagination: {
							page: 2,
							total: 2,
							limit: 100,
							totalPages: 2,
							hasNextPage: false,
							hasPreviousPage: true,
						},
					},
				},
			},
		};
		const queryEngineClient: QueryEngineClient = (payload) => {
			calls.push(payload);
			return Promise.resolve(pageResponses[payload.pagination.page]);
		};

		const collections = await loadRelatedCollections(queryEngineClient, { entityId: "entity-1" });

		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			fields: [{ key: "collectionId" }, { key: "collectionName" }],
			relationshipJoins: [
				{
					required: true,
					direction: "incoming",
					sourceEntityId: "entity-1",
					kind: "latestRelationship",
					key: "collectionMembership",
					relationshipSchemaSlug: "member-of",
				},
			],
		});
		expect(collections).toEqual([
			{ id: "collection-1", name: "Reading" },
			{ id: "collection-2", name: "Favorites" },
		]);
	});
});
