import type { NamedQuery } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	buildImportRunDocument,
	buildIntegrationImportRunsDocument,
	buildManualImportRunsDocument,
	decodeImportRunResponse,
	decodeImportRunsResponse,
} from "./import-runs";

const runItem = {
	id: { kind: "text", value: "run-1" },
	source: { kind: "text", value: "csv" },
	progress: { kind: "number", value: 100 },
	totalItems: { kind: "number", value: 8 },
	failedItems: { kind: "number", value: 1 },
	importedItems: { kind: "number", value: 7 },
	status: { kind: "text", value: "completed" },
	processedItems: { kind: "number", value: 8 },
	errorSummary: { kind: "text", value: "One failed" },
	createdAt: { kind: "date", value: "2026-01-01T01:00:00+02:00" },
	updatedAt: { kind: "date", value: "2026-01-02T01:00:00+02:00" },
	startedAt: { kind: "date", value: "2026-01-01T01:05:00+02:00" },
	inputSummary: { kind: "json", value: { filename: "items.csv" } },
	finishedAt: { kind: "date", value: "2026-01-01T01:10:00+02:00" },
} as const;

const failureItem = {
	runId: { kind: "text", value: "run-1" },
	itemIndex: { kind: "number", value: 4 },
	id: { kind: "text", value: "failure-1" },
	sourceLabel: { kind: "text", value: "Row 5" },
	message: { kind: "text", value: "Invalid item" },
	entitySchemaSlug: { kind: "text", value: "movie" },
	sourceIdentifier: { kind: "text", value: "item-5" },
	eventSchemaSlug: { kind: "text", value: "watched" },
	context: { kind: "json", value: { column: "title" } },
	stage: { kind: "text", value: "input_transformation" },
	createdAt: { kind: "date", value: "2026-01-01T01:06:00+02:00" },
} as const;

const pageInfo = { hasMore: true, limit: 2, page: 3, total: 7 } as const;
const rowsResponse = (items: readonly unknown[], type = "rows") => ({ type, pageInfo, items });

const importRunsResponse = { data: { importRuns: rowsResponse([runItem]) } };

const importRunResponse = {
	data: { run: rowsResponse([runItem]), failures: rowsResponse([failureItem]) },
};

const fieldKeys = (query: NamedQuery) =>
	query.output.type === "rows"
		? query.output.fields.map((selection) => {
				if (!("key" in selection)) {
					throw new Error("Expected an explicit field selection");
				}
				return selection.key;
			})
		: [];

describe("import-run recipes", () => {
	it("builds manual and integration lists with exact fields, pagination, filters, and stable order", () => {
		const manualDocument = buildManualImportRunsDocument({ page: 3, limit: 7 });
		const integrationDocument = buildIntegrationImportRunsDocument({
			page: 2,
			limit: 5,
			integrationId: "integration-1",
		});
		const manual = manualDocument.queries.importRuns;
		const integration = integrationDocument.queries.importRuns;

		expect(Object.keys(manualDocument.queries)).toEqual(["importRuns"]);
		expect(manual.output.pagination).toEqual({ limit: 7, page: 3 });
		expect(integration.output.pagination).toEqual({ limit: 5, page: 2 });
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
			"errorSummary",
		]);
		expect(manual.where).toEqual({
			type: "isNull",
			expr: { field: "integrationId", tableAlias: "importRun", type: "column" },
		});
		expect(integration.where).toMatchObject({
			type: "comparison",
			right: { value: "integration-1" },
			left: { field: "integrationId", tableAlias: "importRun" },
		});
		expect(manual.output.orderBy).toEqual([
			{ direction: "desc", expr: { field: "createdAt", tableAlias: "importRun", type: "column" } },
			{ direction: "asc", expr: { field: "id", tableAlias: "importRun", type: "column" } },
		]);
		expect(integration.output.orderBy).toEqual(manual.output.orderBy);
	});

	it("builds detail roots in one document with independent pagination, filters, fields, and order", () => {
		const document = buildImportRunDocument({
			runId: "run-1",
			failurePage: 4,
			failureLimit: 6,
		});
		const run = document.queries.run;
		const failures = document.queries.failures;

		expect(Object.keys(document.queries)).toEqual(["run", "failures"]);
		expect(run.output.pagination).toEqual({ limit: 1, page: 1 });
		expect(failures.output.pagination).toEqual({ limit: 6, page: 4 });
		expect(run.where).toMatchObject({ left: { field: "id" }, right: { value: "run-1" } });
		expect(failures.where).toMatchObject({
			right: { value: "run-1" },
			left: { field: "runId", tableAlias: "failure" },
		});
		expect(fieldKeys(failures)).toEqual([
			"id",
			"runId",
			"message",
			"createdAt",
			"itemIndex",
			"stage",
			"context",
			"sourceLabel",
			"sourceIdentifier",
			"eventSchemaSlug",
			"entitySchemaSlug",
		]);
		expect(failures.output.orderBy).toEqual([
			{ direction: "asc", expr: { field: "createdAt", tableAlias: "failure", type: "column" } },
			{ direction: "asc", expr: { field: "id", tableAlias: "failure", type: "column" } },
		]);
	});

	it("decodes run lists, nullable fields, page info, and normalized dates", () => {
		expect(Result.getOrThrow(decodeImportRunsResponse(importRunsResponse))).toEqual({
			pageInfo,
			items: [
				{
					id: "run-1",
					source: "csv",
					progress: 100,
					totalItems: 8,
					failedItems: 1,
					importedItems: 7,
					processedItems: 8,
					status: "completed",
					errorSummary: "One failed",
					createdAt: "2025-12-31T23:00:00.000Z",
					updatedAt: "2026-01-01T23:00:00.000Z",
					startedAt: "2025-12-31T23:05:00.000Z",
					finishedAt: "2025-12-31T23:10:00.000Z",
					inputSummary: { filename: "items.csv" },
				},
			],
		});

		const nullableRun = {
			...runItem,
			startedAt: { kind: "null", value: null },
			finishedAt: { kind: "null", value: null },
			totalItems: { kind: "null", value: null },
			errorSummary: { kind: "null", value: null },
		} as const;
		expect(
			Result.getOrThrow(
				decodeImportRunsResponse({ data: { importRuns: rowsResponse([nullableRun]) } }),
			).items[0],
		).toMatchObject({ startedAt: null, finishedAt: null, totalItems: null, errorSummary: null });
	});

	it("decodes detail failures with page info and returns a null missing run", () => {
		expect(Result.getOrThrow(decodeImportRunResponse(importRunResponse))).toMatchObject({
			run: { id: "run-1" },
			failures: {
				pageInfo,
				items: [
					{
						itemIndex: 4,
						runId: "run-1",
						id: "failure-1",
						context: { column: "title" },
						stage: "input_transformation",
						createdAt: "2025-12-31T23:06:00.000Z",
					},
				],
			},
		});
		expect(
			Result.getOrThrow(
				decodeImportRunResponse({
					data: { run: rowsResponse([]), failures: rowsResponse([failureItem]) },
				}),
			).run,
		).toBeNull();

		const nullableFailure = {
			...failureItem,
			context: { kind: "null", value: null },
			sourceLabel: { kind: "null", value: null },
			eventSchemaSlug: { kind: "null", value: null },
			entitySchemaSlug: { kind: "null", value: null },
			sourceIdentifier: { kind: "null", value: null },
		} as const;
		expect(
			Result.getOrThrow(
				decodeImportRunResponse({
					data: { run: rowsResponse([runItem]), failures: rowsResponse([nullableFailure]) },
				}),
			).failures.items[0],
		).toMatchObject({
			context: null,
			sourceLabel: null,
			eventSchemaSlug: null,
			sourceIdentifier: null,
			entitySchemaSlug: null,
		});
	});

	it("rejects missing fields and wrong kinds", () => {
		for (const field of Object.keys(runItem)) {
			const item = { ...runItem } as Record<string, unknown>;
			delete item[field];
			expect(
				Result.isFailure(decodeImportRunsResponse({ data: { importRuns: rowsResponse([item]) } })),
			).toBe(true);
		}

		for (const [field, value] of Object.entries({
			id: { kind: "number", value: 1 },
			progress: { kind: "text", value: "100" },
			status: { kind: "text", value: "unknown" },
			inputSummary: { kind: "text", value: "{}" },
			createdAt: { kind: "text", value: "2026-01-01" },
		})) {
			expect(
				Result.isFailure(
					decodeImportRunsResponse({
						data: { importRuns: rowsResponse([{ ...runItem, [field]: value }]) },
					}),
				),
			).toBe(true);
		}

		const missingFailure = { ...failureItem } as Record<string, unknown>;
		delete missingFailure.message;
		expect(
			Result.isFailure(
				decodeImportRunResponse({
					data: { run: rowsResponse([runItem]), failures: rowsResponse([missingFailure]) },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeImportRunResponse({
					data: {
						run: rowsResponse([runItem]),
						failures: rowsResponse([{ ...failureItem, stage: { kind: "number", value: 1 } }]),
					},
				}),
			),
		).toBe(true);
	});

	it("rejects wrong output types and query names", () => {
		expect(Result.isFailure(decodeImportRunsResponse({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(decodeImportRunsResponse({ data: { runs: rowsResponse([runItem]) } })),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeImportRunsResponse({ data: { importRuns: rowsResponse([runItem], "aggregate") } }),
			),
		).toBe(true);

		expect(Result.isFailure(decodeImportRunResponse({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				decodeImportRunResponse({
					data: { importRun: rowsResponse([runItem]), failures: rowsResponse([failureItem]) },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeImportRunResponse({
					data: {
						run: rowsResponse([runItem]),
						failures: rowsResponse([failureItem], "aggregate"),
					},
				}),
			),
		).toBe(true);
	});
});
