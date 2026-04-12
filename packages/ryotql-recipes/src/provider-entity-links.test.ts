import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { SandboxProviderId } from "@ryot/contract/schema/brands";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	buildProviderEntityLinksDocument,
	decodeProviderEntityLinksResponse,
} from "./provider-entity-links";

const providerEntityLinksResponse = {
	data: {
		links: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 2, nextCursor: null },
			items: [
				{
					externalId: { kind: "text", value: "external-1" },
				},
				{
					externalId: { kind: "text", value: "external-2" },
				},
			],
		},
	},
} satisfies RyotQLResponse;

const responseWithItems = (items: readonly unknown[]) => ({
	data: { links: { ...providerEntityLinksResponse.data.links, items } },
});

describe("provider entity links recipe", () => {
	it("builds the provider-scoped external id lookup", () => {
		const query = buildProviderEntityLinksDocument({
			externalIds: ["external-1", "external-2"],
			providerId: SandboxProviderId.make("provider-1"),
		}).queries.links;

		expect(query.from).toEqual({ alias: "entity", table: "entity" });
		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.output.orderBy).toEqual([
			{ direction: "asc", expr: { type: "column", tableAlias: "entity", field: "id" } },
		]);
		expect(query.where).toEqual({
			type: "and",
			predicates: [
				{
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "provider-1" },
					left: { type: "column", tableAlias: "entity", field: "providerId" },
				},
				{
					type: "in",
					expr: { type: "column", tableAlias: "entity", field: "externalId" },
					values: [
						{ type: "literal", value: "external-1" },
						{ type: "literal", value: "external-2" },
					],
				},
			],
		});
		expect(
			query.output.fields.map((selection) => {
				if (!("key" in selection)) {
					throw new Error("Expected an explicit field selection");
				}
				return selection.key;
			}),
		).toEqual(["externalId"]);
	});

	it("decodes matching external ids in row order", () => {
		expect(
			Result.getOrThrow(decodeProviderEntityLinksResponse(providerEntityLinksResponse)),
		).toEqual([{ externalId: "external-1" }, { externalId: "external-2" }]);
	});

	it("decodes an empty result set", () => {
		expect(Result.getOrThrow(decodeProviderEntityLinksResponse(responseWithItems([])))).toEqual([]);
	});

	it("rejects a row with a null external id", () => {
		expect(
			Result.isFailure(
				decodeProviderEntityLinksResponse(
					responseWithItems([
						{
							externalId: { kind: "null", value: null },
						},
					]),
				),
			),
		).toBe(true);
	});
});
