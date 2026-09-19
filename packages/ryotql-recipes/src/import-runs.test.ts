import type { NamedQuery } from "@ryot-app/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	importRunRecipe,
	integrationImportRunsRecipe,
	manualImportRunsRecipe,
} from "./import-runs";
import { requireRowsQuery } from "./test-utils";

const runItem = {
	summary: [],
	id: "run-1",
	source: "csv",
	activities: [],
	blockReasons: [],
	expiryReason: null,
	blockDeadline: null,
	status: "completed",
	createdAt: "2026-01-01T01:00:00+02:00",
	updatedAt: "2026-01-02T01:00:00+02:00",
	startedAt: "2026-01-01T01:05:00+02:00",
	inputSummary: { filename: "items.csv" },
	finishedAt: "2026-01-01T01:10:00+02:00",
	failureReason: { code: "input-transformation-failed" },
};
const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" };
const rows = (items: readonly unknown[], limit = 2, type = "rows") => ({
	type,
	items,
	pageInfo: { ...pageInfo, limit },
});
const fieldKeys = (query: NamedQuery) =>
	query.output.type === "rows"
		? query.output.fields.map((field) => ("key" in field ? field.key : null))
		: [];

describe("import-run recipes", () => {
	it("prepares manual and integration lists with fields, pagination, filters, and order", () => {
		const manual = requireRowsQuery(
			manualImportRunsRecipe({ limit: 7, after: "manual-cursor" }).document.queries.importRuns,
		);
		const integration = requireRowsQuery(
			integrationImportRunsRecipe({
				limit: 5,
				after: "integration-cursor",
				integrationId: "integration-1",
			}).document.queries.importRuns,
		);

		expect(manual.output.pagination).toEqual({ limit: 7, after: "manual-cursor" });
		expect(integration.output.pagination).toEqual({ limit: 5, after: "integration-cursor" });
		expect(fieldKeys(manual)).toEqual([
			"id",
			"source",
			"createdAt",
			"updatedAt",
			"inputSummary",
			"summary",
			"status",
			"startedAt",
			"finishedAt",
			"activities",
			"blockDeadline",
			"blockReasons",
			"expiryReason",
			"failureReason",
		]);
		expect(manual.where).toMatchObject({ type: "isNull", expr: { field: "integrationId" } });
		expect(integration.where).toMatchObject({ right: { value: "integration-1" } });
		expect(integration.output.orderBy).toEqual(manual.output.orderBy);
	});

	it("prepares optional run detail without obsolete failure queries", () => {
		const document = importRunRecipe({ runId: "run-1" }).document;
		expect(Object.keys(document.queries)).toEqual(["run"]);
		expect(requireRowsQuery(document.queries.run).output.pagination).toEqual({ limit: 2 });
	});

	it("decodes list plain values, nulls, page info, and normalized dates", () => {
		const recipe = manualImportRunsRecipe({ limit: 2 });
		const decoded = Result.getOrThrow(recipe.decode({ data: { importRuns: rows([runItem]) } }));

		expect(decoded.items[0]).toEqual({
			...runItem,
			createdAt: "2025-12-31T23:00:00.000Z",
			updatedAt: "2026-01-01T23:00:00.000Z",
			startedAt: "2025-12-31T23:05:00.000Z",
			finishedAt: "2025-12-31T23:10:00.000Z",
		});
		expect(decoded.pageInfo).toEqual(pageInfo);
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						importRuns: rows([
							{ ...runItem, startedAt: null, finishedAt: null, failureReason: null },
						]),
					},
				}),
			).items[0],
		).toMatchObject({ startedAt: null, finishedAt: null, failureReason: null });
	});

	it("decodes detail and an absent run", () => {
		const recipe = importRunRecipe({ runId: "run-1" });
		const decoded = Result.getOrThrow(recipe.decode({ data: { run: rows([runItem], 2) } }));
		expect(decoded).toMatchObject({ run: { id: "run-1" } });
		expect(Result.getOrThrow(recipe.decode({ data: { run: rows([], 2) } })).run).toBeUndefined();
	});

	it("rejects malformed JSON, dates, and enum values", () => {
		const listRecipe = manualImportRunsRecipe({ limit: 2 });

		for (const malformed of [
			{ ...runItem, status: "unknown" },
			{ ...runItem, inputSummary: "not-json" },
			{ ...runItem, createdAt: "not-a-date" },
		]) {
			expect(Result.isFailure(listRecipe.decode({ data: { importRuns: rows([malformed]) } }))).toBe(
				true,
			);
		}
		const detailRecipe = importRunRecipe({ runId: "run-1" });
		expect(
			Result.isFailure(
				detailRecipe.decode({ data: { run: rows([{ ...runItem, createdAt: "not-a-date" }], 2) } }),
			),
		).toBe(true);
	});

	it("rejects excess run cardinality and malformed result shapes", () => {
		const detailRecipe = importRunRecipe({ runId: "run-1" });

		expect(
			Result.isFailure(detailRecipe.decode({ data: { run: rows([runItem, runItem], 2) } })),
		).toBe(true);
		expect(Result.isFailure(manualImportRunsRecipe({ limit: 2 }).decode({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				manualImportRunsRecipe({ limit: 2 }).decode({
					data: { importRuns: rows([runItem], 2, "aggregate") },
				}),
			),
		).toBe(true);
	});
});
