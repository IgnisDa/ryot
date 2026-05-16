import { describe, expect, it } from "bun:test";

import { loadRelatedCompanies } from "./companies";
import type {
	QueryEngineClient,
	QueryEngineEntitiesRequestBody,
	QueryEngineEntitiesResponse,
	QueryEngineRequestBody,
} from "./query-engine";

describe("entity-detail companies helpers", () => {
	it("loads and orders related companies across pages", async () => {
		const calls: QueryEngineEntitiesRequestBody[] = [];
		const pageResponses: Record<number, QueryEngineEntitiesResponse> = {
			1: {
				mode: "entities",
				data: {
					items: [
						{
							companyId: { kind: "text", value: "company-2" },
							relationshipOrder: { kind: "number", value: 2 },
							companyName: { kind: "text", value: "Studio B" },
							relationshipRoles: { kind: "json", value: ["production_company"] },
							relationshipCreatedAt: { kind: "text", value: "2024-01-02T00:00:00.000Z" },
							companyImage: {
								kind: "image",
								value: { type: "remote", url: "https://example.com/studio-b.jpg" },
							},
						},
					],
					meta: {
						fieldOrder: ["companyName"],
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
							companyId: { kind: "text", value: "company-1" },
							relationshipOrder: { kind: "number", value: 1 },
							companyName: { kind: "text", value: "Studio A" },
							relationshipRoles: { kind: "json", value: ["studio", "publisher"] },
							relationshipCreatedAt: { kind: "text", value: "2024-01-01T00:00:00.000Z" },
							companyImage: {
								kind: "image",
								value: { type: "remote", url: "https://example.com/studio-a.jpg" },
							},
						},
					],
					meta: {
						fieldOrder: ["companyName"],
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
		const apiClient: QueryEngineClient = {
			POST(_path: "/query-engine/execute", options: { body: QueryEngineRequestBody }) {
				if (options.body.mode !== "entities") {
					throw new Error("Expected an entity query");
				}

				calls.push(options.body);
				return Promise.resolve({ data: pageResponses[options.body.pagination.page] });
			},
		};

		const companies = await loadRelatedCompanies(apiClient, {
			entityId: "entity-1",
			entitySchemaSlug: "movie",
		});

		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			scope: ["company"],
			relationshipJoins: [
				{
					required: true,
					direction: "outgoing",
					key: "companyRelationship",
					kind: "latestRelationship",
					targetEntityId: "entity-1",
					relationshipSchemaSlug: "company-to-movie",
				},
			],
			fields: [
				{ key: "companyId" },
				{ key: "companyName" },
				{ key: "companyImage" },
				{ key: "relationshipRoles" },
				{ key: "relationshipOrder" },
				{ key: "relationshipCreatedAt" },
			],
		});
		expect(companies).toEqual([
			{
				id: "company-1",
				name: "Studio A",
				role: "Studio, Publisher",
				image: { type: "remote", url: "https://example.com/studio-a.jpg" },
			},
			{
				id: "company-2",
				name: "Studio B",
				role: "Production Company",
				image: { type: "remote", url: "https://example.com/studio-b.jpg" },
			},
		]);
	});
});
