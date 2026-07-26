import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	buildIntegrationDocument,
	buildIntegrationsDocument,
	decodeIntegrationResponse,
	decodeIntegrationsResponse,
} from "./integrations";

const integrationResponse = {
	data: {
		integrations: {
			type: "rows",
			pageInfo: { hasMore: true, limit: 2, page: 3, total: 7 },
			items: [
				{
					lot: { kind: "text", value: "yank" },
					id: { kind: "text", value: "integration-1" },
					isDisabled: { kind: "boolean", value: false },
					maximumProgress: { kind: "number", value: 95 },
					provider: { kind: "text", value: "provider-1" },
					pluginSlug: { kind: "text", value: "plugin-1" },
					syncOwnership: { kind: "boolean", value: true },
					minimumProgress: { kind: "number", value: 2.5 },
					name: { kind: "text", value: "Primary integration" },
					createdAt: { kind: "date", value: "2026-01-01T01:00:00+02:00" },
					updatedAt: { kind: "date", value: "2026-01-02T01:00:00+02:00" },
					lastFinishedAt: { kind: "date", value: "2026-01-03T01:00:00+02:00" },
					extraSettings: { kind: "json", value: { disableOnContinuousErrors: true } },
				},
			],
		},
	},
} satisfies RyotQLResponse;

const integrationItem = integrationResponse.data.integrations.items[0];

const listResponseWithItems = (items: readonly unknown[]) => ({
	data: { integrations: { ...integrationResponse.data.integrations, items } },
});

const detailResponse = (items: readonly unknown[]) => ({
	data: { integration: { ...integrationResponse.data.integrations, items } },
});

describe("integration recipes", () => {
	it("builds the paginated list with exact fields, filters, pagination, and stable ordering", () => {
		const query = buildIntegrationsDocument({
			page: 3,
			limit: 7,
			isDisabled: false,
			provider: "provider-1",
		}).queries.integrations;

		expect(query.output.pagination).toEqual({ limit: 7, page: 3 });
		expect(
			query.output.fields.map((selection) => {
				if (!("key" in selection)) {
					throw new Error("Expected an explicit field selection");
				}
				return selection.key;
			}),
		).toEqual([
			"id",
			"lot",
			"name",
			"provider",
			"pluginSlug",
			"isDisabled",
			"syncOwnership",
			"minimumProgress",
			"maximumProgress",
			"extraSettings",
			"lastFinishedAt",
			"createdAt",
			"updatedAt",
		]);
		expect(query.where).toMatchObject({
			type: "and",
			predicates: [
				{ left: { field: "provider" }, right: { value: "provider-1" } },
				{ left: { field: "isDisabled" }, right: { value: false } },
			],
		});
		expect(query.output.orderBy).toEqual([
			{
				direction: "desc",
				expr: { field: "createdAt", tableAlias: "integration", type: "column" },
			},
			{ direction: "desc", expr: { field: "id", tableAlias: "integration", type: "column" } },
		]);
	});

	it("omits optional predicates when they are not provided", () => {
		expect(
			buildIntegrationsDocument({ page: 1, limit: 5 }).queries.integrations.where,
		).toBeUndefined();
	});

	it("builds the by-id query with a limit of one and a named key", () => {
		const document = buildIntegrationDocument({ id: "integration-1" });
		const query = document.queries.integration;

		expect(Object.keys(document.queries)).toEqual(["integration"]);
		expect(query.output.pagination).toEqual({ limit: 1, page: 1 });
		expect(query.where).toMatchObject({
			type: "comparison",
			right: { value: "integration-1" },
			left: { field: "id", tableAlias: "integration" },
		});
	});

	it("decodes summaries, nullable fields, numbers, JSON, page info, and normalized dates", () => {
		expect(Result.getOrThrow(decodeIntegrationsResponse(integrationResponse))).toEqual({
			pageInfo: { hasMore: true, limit: 2, page: 3, total: 7 },
			items: [
				{
					lot: "yank",
					isDisabled: false,
					id: "integration-1",
					syncOwnership: true,
					maximumProgress: 95,
					minimumProgress: 2.5,
					provider: "provider-1",
					pluginSlug: "plugin-1",
					name: "Primary integration",
					createdAt: "2025-12-31T23:00:00.000Z",
					updatedAt: "2026-01-01T23:00:00.000Z",
					lastFinishedAt: "2026-01-02T23:00:00.000Z",
					extraSettings: { disableOnContinuousErrors: true },
				},
			],
		});

		const nullableItem = {
			...integrationItem,
			name: { kind: "null", value: null },
			lastFinishedAt: { kind: "null", value: null },
		};
		expect(
			Result.getOrThrow(decodeIntegrationsResponse(listResponseWithItems([nullableItem]))).items[0],
		).toMatchObject({ name: null, lastFinishedAt: null });
	});

	it("decodes a detail record and returns null when it is absent", () => {
		expect(
			Result.getOrThrow(decodeIntegrationResponse(detailResponse([integrationItem]))),
		).toMatchObject({
			lot: "yank",
			id: "integration-1",
			maximumProgress: 95,
			minimumProgress: 2.5,
			name: "Primary integration",
		});
		expect(Result.getOrThrow(decodeIntegrationResponse(detailResponse([])))).toBeNull();
	});

	it("rejects missing fields", () => {
		for (const field of [
			"id",
			"lot",
			"name",
			"provider",
			"pluginSlug",
			"isDisabled",
			"syncOwnership",
			"minimumProgress",
			"maximumProgress",
			"extraSettings",
			"lastFinishedAt",
			"createdAt",
			"updatedAt",
		]) {
			const item = { ...integrationItem } as Record<string, unknown>;
			delete item[field];
			expect(Result.isFailure(decodeIntegrationsResponse(listResponseWithItems([item])))).toBe(
				true,
			);
		}
	});

	it("rejects wrong field kinds and invalid field values", () => {
		const wrongKinds = {
			id: { kind: "number", value: 1 },
			lot: { kind: "json", value: "yank" },
			name: { kind: "boolean", value: true },
			provider: { kind: "number", value: 1 },
			updatedAt: { kind: "number", value: 1 },
			pluginSlug: { kind: "json", value: {} },
			isDisabled: { kind: "text", value: "false" },
			lastFinishedAt: { kind: "number", value: 1 },
			syncOwnership: { kind: "text", value: "true" },
			minimumProgress: { kind: "text", value: "2.5" },
			createdAt: { kind: "text", value: "2026-01-01" },
			maximumProgress: { kind: "boolean", value: true },
			extraSettings: { kind: "text", value: "not-json" },
		};

		for (const [field, value] of Object.entries(wrongKinds)) {
			expect(
				Result.isFailure(
					decodeIntegrationsResponse(
						listResponseWithItems([{ ...integrationItem, [field]: value }]),
					),
				),
			).toBe(true);
		}

		for (const field of ["createdAt", "updatedAt", "lastFinishedAt"]) {
			expect(
				Result.isFailure(
					decodeIntegrationsResponse(
						listResponseWithItems([
							{ ...integrationItem, [field]: { kind: "date", value: "not-a-date" } },
						]),
					),
				),
			).toBe(true);
		}
		expect(
			Result.isFailure(
				decodeIntegrationsResponse(
					listResponseWithItems([{ ...integrationItem, lot: { kind: "text", value: "unknown" } }]),
				),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeIntegrationsResponse(
					listResponseWithItems([
						{ ...integrationItem, extraSettings: { kind: "json", value: {} } },
					]),
				),
			),
		).toBe(true);
	});

	it("rejects wrong query names and output types", () => {
		expect(Result.isFailure(decodeIntegrationsResponse({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				decodeIntegrationsResponse({
					data: { integration: integrationResponse.data.integrations },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeIntegrationsResponse({
					data: { integrations: { ...integrationResponse.data.integrations, type: "aggregate" } },
				}),
			),
		).toBe(true);

		expect(Result.isFailure(decodeIntegrationResponse({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				decodeIntegrationResponse({
					data: { integrations: integrationResponse.data.integrations },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeIntegrationResponse({
					data: { integration: { ...integrationResponse.data.integrations, type: "aggregate" } },
				}),
			),
		).toBe(true);
	});
});
