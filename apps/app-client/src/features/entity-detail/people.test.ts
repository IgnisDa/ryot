import { describe, expect, it } from "bun:test";

import { formatRoleLabel, loadRelatedCreators, mergeCreators } from "./people";
import type {
	QueryEngineClient,
	QueryEngineEntitiesRequestBody,
	QueryEngineEntitiesResponse,
	QueryEngineRequestBody,
} from "./query-engine";

describe("entity-detail people helpers", () => {
	it("formats role slugs into readable labels", () => {
		expect(formatRoleLabel("executiveProducer")).toBe("Executive Producer");
		expect(formatRoleLabel("tvdb-host")).toBe("TVDB Host");
	});

	it("keeps same-name related people separate when their ids differ", () => {
		expect(
			mergeCreators(
				[{ name: "Denis Villeneuve", role: "Director" }],
				[
					{
						id: "person-1",
						name: "Denis Villeneuve",
						role: "Director, Writer",
						image: { type: "remote", url: "query.jpg" },
					},
					{ id: "person-2", name: "Denis Villeneuve", role: "Actor" },
				],
			),
		).toEqual([
			{ name: "Denis Villeneuve", role: "Director" },
			{
				id: "person-1",
				name: "Denis Villeneuve",
				role: "Director, Writer",
				image: { type: "remote", url: "query.jpg" },
			},
			{ id: "person-2", name: "Denis Villeneuve", role: "Actor" },
		]);
	});

	it("loads and orders related creators across pages", async () => {
		const calls: QueryEngineEntitiesRequestBody[] = [];
		const pageResponses: Record<number, QueryEngineEntitiesResponse> = {
			1: {
				mode: "entities",
				data: {
					items: [
						{
							personName: { kind: "text", value: "Bob" },
							personId: { kind: "text", value: "person-2" },
							relationshipOrder: { kind: "number", value: 2 },
							relationshipRoles: { kind: "json", value: ["director"] },
							relationshipCreatedAt: { kind: "text", value: "2024-01-02T00:00:00.000Z" },
							personImage: {
								kind: "image",
								value: { type: "remote", url: "https://example.com/bob.jpg" },
							},
						},
					],
					meta: {
						fieldOrder: ["personName"],
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
							personName: { kind: "text", value: "Alice" },
							personId: { kind: "text", value: "person-1" },
							relationshipOrder: { kind: "number", value: 1 },
							relationshipRoles: { kind: "json", value: ["writer", "editor"] },
							relationshipCreatedAt: { kind: "text", value: "2024-01-01T00:00:00.000Z" },
							personImage: {
								kind: "image",
								value: { type: "remote", url: "https://example.com/alice.jpg" },
							},
						},
					],
					meta: {
						fieldOrder: ["personName"],
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

		const creators = await loadRelatedCreators(apiClient, {
			entityId: "entity-1",
			entitySchemaSlug: "movie",
		});

		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			scope: ["person"],
			relationshipJoins: [
				{
					required: true,
					direction: "outgoing",
					key: "personRelationship",
					kind: "latestRelationship",
					targetEntityId: "entity-1",
					relationshipSchemaSlug: "person-to-movie",
				},
			],
			fields: [
				{ key: "personId" },
				{ key: "personName" },
				{ key: "personImage" },
				{ key: "relationshipRoles" },
				{ key: "relationshipOrder" },
				{ key: "relationshipCreatedAt" },
			],
		});
		expect(creators).toEqual([
			{
				name: "Alice",
				id: "person-1",
				role: "Writer, Editor",
				image: { type: "remote", url: "https://example.com/alice.jpg" },
			},
			{
				name: "Bob",
				id: "person-2",
				role: "Director",
				image: { type: "remote", url: "https://example.com/bob.jpg" },
			},
		]);
	});
});
