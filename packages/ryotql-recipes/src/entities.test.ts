import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { buildEntityInterestDocument, decodeEntityInterestResponse } from "./entities";
import { buildEntityReadDocument } from "./sandbox";

const entityInterestResponse = {
	data: {
		entities: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 1, nextCursor: null },
			items: [
				{
					id: { kind: "text", value: "entity-1" },
					externalId: { kind: "text", value: "external-1" },
					entitySchemaSlug: { kind: "text", value: "book" },
					providerId: { kind: "text", value: "provider-1" },
					properties: { kind: "json", value: { pages: 320 } },
					translationStatus: { kind: "text", value: "ready" },
					populatedAt: { kind: "date", value: "2026-01-01T01:00:00+02:00" },
				},
			],
		},
	},
} satisfies RyotQLResponse;

const entityInterestItem = entityInterestResponse.data.entities.items[0];

const responseWithItems = (items: readonly unknown[]) => ({
	data: { entities: { ...entityInterestResponse.data.entities, items } },
});

describe("entity recipes", () => {
	it("builds the sandbox entity read by visible ids", () => {
		expect(
			buildEntityReadDocument({ entityIds: ["entity-1", "entity-2"] }).queries.entities.where,
		).toEqual({
			type: "in",
			expr: { type: "column", tableAlias: "entity", field: "id" },
			values: [
				{ type: "literal", value: "entity-1" },
				{ type: "literal", value: "entity-2" },
			],
		});
	});

	it("builds the focused entity interest read", () => {
		const query = buildEntityInterestDocument({ entityIds: ["entity-1", "entity-2"] }).queries[
			"entities"
		];

		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(
			query.output.fields.map((selection) => {
				if (!("key" in selection)) {
					throw new Error("Expected an explicit field selection");
				}
				return selection.key;
			}),
		).toEqual([
			"id",
			"properties",
			"externalId",
			"populatedAt",
			"entitySchemaSlug",
			"providerId",
			"translationStatus",
		]);
		expect(query.where).toMatchObject({
			type: "in",
			expr: { field: "id" },
			values: [{ value: "entity-1" }, { value: "entity-2" }],
		});
		expect(query.output.orderBy).toEqual([
			{ direction: "asc", expr: { type: "column", tableAlias: "entity", field: "id" } },
		]);
	});

	it("decodes valid entity interest values and normalizes dates", () => {
		expect(Result.getOrThrow(decodeEntityInterestResponse(entityInterestResponse))).toEqual([
			{
				id: "entity-1",
				externalId: "external-1",
				providerId: "provider-1",
				entitySchemaSlug: "book",
				properties: { pages: 320 },
				translationStatus: "ready",
				populatedAt: "2025-12-31T23:00:00.000Z",
			},
		]);
	});

	it("decodes nullable entity interest values", () => {
		const response = responseWithItems([
			{
				...entityInterestItem,
				externalId: { kind: "null", value: null },
				providerId: { kind: "null", value: null },
				populatedAt: { kind: "null", value: null },
			},
		]);

		expect(Result.getOrThrow(decodeEntityInterestResponse(response))).toEqual([
			{
				id: "entity-1",
				externalId: null,
				providerId: null,
				populatedAt: null,
				entitySchemaSlug: "book",
				properties: { pages: 320 },
				translationStatus: "ready",
			},
		]);
	});

	it("rejects entity interest rows with missing fields", () => {
		for (const field of [
			"id",
			"properties",
			"externalId",
			"populatedAt",
			"entitySchemaSlug",
			"providerId",
			"translationStatus",
		]) {
			const item = { ...entityInterestItem } as Record<string, unknown>;
			delete item[field];
			expect(Result.isFailure(decodeEntityInterestResponse(responseWithItems([item])))).toBe(true);
		}
	});

	it("rejects entity interest rows with wrong field kinds", () => {
		const wrongKinds = {
			id: { kind: "number", value: 1 },
			externalId: { kind: "json", value: {} },
			providerId: { kind: "boolean", value: true },
			entitySchemaSlug: { kind: "json", value: {} },
			translationStatus: { kind: "number", value: 1 },
			properties: { kind: "text", value: "not-json" },
			populatedAt: { kind: "text", value: "2026-01-01" },
		};

		for (const [field, value] of Object.entries(wrongKinds)) {
			expect(
				Result.isFailure(
					decodeEntityInterestResponse(
						responseWithItems([{ ...entityInterestItem, [field]: value }]),
					),
				),
			).toBe(true);
		}
	});

	it("rejects an invalid populated date", () => {
		expect(
			Result.isFailure(
				decodeEntityInterestResponse(
					responseWithItems([
						{ ...entityInterestItem, populatedAt: { kind: "date", value: "not-a-date" } },
					]),
				),
			),
		).toBe(true);
	});

	it("rejects a response with a missing or wrong query name", () => {
		expect(Result.isFailure(decodeEntityInterestResponse({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				decodeEntityInterestResponse({ data: { entity: entityInterestResponse.data.entities } }),
			),
		).toBe(true);
	});

	it("rejects a non-rows result under the entities query name", () => {
		expect(
			Result.isFailure(
				decodeEntityInterestResponse({
					data: { entities: { ...entityInterestResponse.data.entities, type: "aggregate" } },
				}),
			),
		).toBe(true);
	});
});
