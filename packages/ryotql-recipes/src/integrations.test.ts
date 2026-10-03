import { Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import { integrationRecipe, integrationsRecipe } from "./integrations";
import { requireRowsQuery, rowsResult } from "./test-utils";

const item = {
	lot: "yank",
	isDisabled: false,
	id: "integration-1",
	maximumProgress: 95,
	syncOwnership: true,
	minimumProgress: 2.5,
	provider: "provider-1",
	pluginSlug: "plugin-1",
	name: "Primary integration",
	createdAt: "2026-01-01T01:00:00+02:00",
	updatedAt: "2026-01-02T01:00:00+02:00",
	lastFinishedAt: "2026-01-03T01:00:00+02:00",
	extraSettings: { disableOnContinuousErrors: true },
};
const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" };
const rows = (items: readonly unknown[], limit = 2) => rowsResult(items, { ...pageInfo, limit });

describe("integration recipes", () => {
	it("prepares list fields, filters, pagination, and stable ordering", () => {
		const query = requireRowsQuery(
			integrationsRecipe({ limit: 7, after: "cursor", isDisabled: false, provider: "provider-1" })
				.document.queries.integrations,
		);

		expect(query.output.pagination).toEqual({ limit: 7, after: "cursor" });
		expect(query.where).toMatchObject({
			predicates: [
				{ left: { field: "provider" }, right: { value: "provider-1" } },
				{ right: { value: false }, left: { field: "isDisabled" } },
			],
		});
		expect(query.output.orderBy).toEqual([
			{
				direction: "desc",
				expr: { type: "column", field: "createdAt", tableAlias: "integration" },
			},
			{ direction: "desc", expr: { field: "id", type: "column", tableAlias: "integration" } },
		]);
		expect(
			requireRowsQuery(integrationsRecipe({ limit: 5 }).document.queries.integrations).where,
		).toBeUndefined();
	});

	it("prepares optional by-id detail with cardinality limit two", () => {
		const query = requireRowsQuery(
			integrationRecipe({ id: "integration-1" }).document.queries.integration,
		);

		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.where).toMatchObject({ left: { field: "id" }, right: { value: "integration-1" } });
	});

	it("decodes plain values, JSON, nulls, page info, and normalized dates", () => {
		const recipe = integrationsRecipe({ limit: 2 });
		const decoded = Result.getOrThrow(recipe.decode({ data: { integrations: rows([item]) } }));

		expect(decoded.items[0]).toEqual({
			...item,
			createdAt: "2025-12-31T23:00:00.000Z",
			updatedAt: "2026-01-01T23:00:00.000Z",
			lastFinishedAt: "2026-01-02T23:00:00.000Z",
		});
		expect(decoded.pageInfo).toEqual(pageInfo);
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: { integrations: rows([{ ...item, name: null, lastFinishedAt: null }]) },
				}),
			).items[0],
		).toMatchObject({ name: null, lastFinishedAt: null });
	});

	it("decodes optional detail and rejects excess cardinality", () => {
		const recipe = integrationRecipe({ id: "integration-1" });

		const detail = { ...item, webhookToken: "secret", providerSpecifics: { kind: "provider" } };
		expect(
			Option.isNone(Result.getOrThrow(recipe.decode({ data: { integration: rows([], 2) } }))),
		).toBe(true);
		expect(Result.getOrThrow(recipe.decode({ data: { integration: rows([detail], 2) } }))).toEqual(
			Option.some({
				...detail,
				createdAt: "2025-12-31T23:00:00.000Z",
				updatedAt: "2026-01-01T23:00:00.000Z",
				lastFinishedAt: "2026-01-02T23:00:00.000Z",
			}),
		);
		expect(
			Result.isFailure(recipe.decode({ data: { integration: rows([detail, detail], 2) } })),
		).toBe(true);
	});

	it("rejects malformed JSON, enum values, and dates", () => {
		const recipe = integrationsRecipe({ limit: 2 });

		for (const malformed of [
			{ ...item, lot: "unknown" },
			{ ...item, extraSettings: {} },
			{ ...item, createdAt: "not-a-date" },
			{ ...item, lastFinishedAt: "not-a-date" },
		]) {
			expect(Result.isFailure(recipe.decode({ data: { integrations: rows([malformed]) } }))).toBe(
				true,
			);
		}
	});

	it("rejects missing fields and wrong result shapes", () => {
		const malformed = { ...item } as Record<string, unknown>;
		delete malformed.provider;
		const recipe = integrationsRecipe({ limit: 2 });

		expect(Result.isFailure(recipe.decode({ data: { integrations: rows([malformed]) } }))).toBe(
			true,
		);
		expect(Result.isFailure(recipe.decode({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				recipe.decode({ data: { integrations: { ...rows([item]), type: "aggregate" } } }),
			),
		).toBe(true);
	});
});
