import type { NamedQuery } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	importRunRecipe,
	integrationImportRunsRecipe,
	manualImportRunsRecipe,
} from "./import-runs";
import { requireRowsQuery } from "./test-utils";

const runItem = {
	id: "run-1",
	source: "csv",
	progress: 100,
	totalItems: 8,
	failedItems: 1,
	importedItems: 7,
	processedItems: 8,
	status: "completed",
	createdAt: "2026-01-01T01:00:00+02:00",
	updatedAt: "2026-01-02T01:00:00+02:00",
	startedAt: "2026-01-01T01:05:00+02:00",
	inputSummary: { filename: "items.csv" },
	finishedAt: "2026-01-01T01:10:00+02:00",
	failureReason: { code: "input-transformation-failed" },
};
const failureItem = {
	itemIndex: 4,
	runId: "run-1",
	id: "failure-1",
	sourceLabel: "Row 5",
	entitySchemaSlug: "movie",
	sourceIdentifier: "item-5",
	eventSchemaSlug: "watched",
	stage: "input_transformation",
	createdAt: "2026-01-01T01:06:00+02:00",
	reason: { code: "input-transformation-failed" },
};
const pageInfo = { hasMore: true, limit: 2, nextCursor: "next" };
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
			manualImportRunsRecipe({ after: "manual-cursor", limit: 7 }).document.queries.importRuns,
		);
		const integration = requireRowsQuery(
			integrationImportRunsRecipe({
				after: "integration-cursor",
				limit: 5,
				integrationId: "integration-1",
			}).document.queries.importRuns,
		);

		expect(manual.output.pagination).toEqual({ after: "manual-cursor", limit: 7 });
		expect(integration.output.pagination).toEqual({ after: "integration-cursor", limit: 5 });
		expect(fieldKeys(manual)).toEqual([
			"id",
			"source",
			"status",
			"progress",
			"createdAt",
			"updatedAt",
			"failedItems",
			"inputSummary",
			"importedItems",
			"processedItems",
			"startedAt",
			"finishedAt",
			"totalItems",
			"failureReason",
		]);
		expect(manual.where).toMatchObject({ type: "isNull", expr: { field: "integrationId" } });
		expect(integration.where).toMatchObject({ right: { value: "integration-1" } });
		expect(integration.output.orderBy).toEqual(manual.output.orderBy);
	});

	it("prepares optional run detail and paginated failures in one document", () => {
		const document = importRunRecipe({
			runId: "run-1",
			failureAfter: "failure-cursor",
			failureLimit: 6,
		}).document;

		expect(Object.keys(document.queries)).toEqual(["run", "failures"]);
		expect(requireRowsQuery(document.queries.run).output.pagination).toEqual({ limit: 2 });
		expect(requireRowsQuery(document.queries.failures).output.pagination).toEqual({
			after: "failure-cursor",
			limit: 6,
		});
		expect(fieldKeys(requireRowsQuery(document.queries.failures))).toEqual([
			"id",
			"runId",
			"stage",
			"reason",
			"createdAt",
			"itemIndex",
			"sourceLabel",
			"eventSchemaSlug",
			"entitySchemaSlug",
			"sourceIdentifier",
		]);
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
							{
								...runItem,
								startedAt: null,
								finishedAt: null,
								totalItems: null,
								failureReason: null,
							},
						]),
					},
				}),
			).items[0],
		).toMatchObject({ startedAt: null, finishedAt: null, totalItems: null, failureReason: null });
	});

	it("decodes detail failures, nulls, and an absent run", () => {
		const recipe = importRunRecipe({ runId: "run-1", failureLimit: 2 });
		const decoded = Result.getOrThrow(
			recipe.decode({ data: { run: rows([runItem], 2), failures: rows([failureItem]) } }),
		);

		expect(decoded).toMatchObject({
			run: { id: "run-1" },
			failures: {
				pageInfo,
				items: [
					{
						id: "failure-1",
						runId: "run-1",
						itemIndex: 4,
						reason: { code: "input-transformation-failed" },
						stage: "input_transformation",
						createdAt: "2025-12-31T23:06:00.000Z",
					},
				],
			},
		});
		expect(
			Result.getOrThrow(recipe.decode({ data: { run: rows([], 2), failures: rows([]) } })).run,
		).toBeUndefined();
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						run: rows([runItem], 2),
						failures: rows([
							{
								...failureItem,
								sourceLabel: null,
								eventSchemaSlug: null,
								entitySchemaSlug: null,
								sourceIdentifier: null,
							},
						]),
					},
				}),
			).failures.items[0],
		).toMatchObject({
			sourceLabel: null,
			eventSchemaSlug: null,
			entitySchemaSlug: null,
			sourceIdentifier: null,
		});
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
		const detailRecipe = importRunRecipe({ runId: "run-1", failureLimit: 2 });
		expect(
			Result.isFailure(
				detailRecipe.decode({
					data: {
						run: rows([runItem], 2),
						failures: rows([{ ...failureItem, createdAt: "not-a-date" }]),
					},
				}),
			),
		).toBe(true);
	});

	it("rejects excess run cardinality and malformed result shapes", () => {
		const detailRecipe = importRunRecipe({ runId: "run-1", failureLimit: 2 });

		expect(
			Result.isFailure(
				detailRecipe.decode({
					data: { run: rows([runItem, runItem], 2), failures: rows([]) },
				}),
			),
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
