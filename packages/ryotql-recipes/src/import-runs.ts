import { IngestionIssue, IngestionRun } from "@ryot-app/contract/modules/imports/ingestion";
import { ListedImportRun } from "@ryot-app/contract/modules/imports/schemas";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	descending,
	eq,
	isNull,
	literal,
	table,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const importRun = table("importRun", "importRun");
const run = table("importRun", "run");
const inputSummary = ListedImportRun.fields.inputSummary;
const runSelection = (source: typeof importRun) => ({
	id: selectedField(column(source, "id"), ImportRunId),
	source: selectedField(column(source, "source"), Schema.String),
	createdAt: selectedField(column(source, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(source, "updatedAt"), IsoDateString),
	inputSummary: selectedField(column(source, "inputSummary"), inputSummary),
	summary: selectedField(column(source, "summary"), IngestionRun.fields.summary),
	status: selectedField(column(source, "status"), ListedImportRun.fields.status),
	startedAt: selectedField(column(source, "startedAt"), Schema.NullOr(IsoDateString)),
	finishedAt: selectedField(column(source, "finishedAt"), Schema.NullOr(IsoDateString)),
	activities: selectedField(column(source, "activities"), IngestionRun.fields.activities),
	blockDeadline: selectedField(column(source, "blockDeadline"), Schema.NullOr(IsoDateString)),
	blockReasons: selectedField(column(source, "blockReasons"), IngestionRun.fields.blockReasons),
	expiryReason: selectedField(column(source, "expiryReason"), IngestionRun.fields.expiryReason),
	failureReason: selectedField(
		column(source, "failureReason"),
		Schema.NullOr(ListedImportRun.fields.failureReason),
	),
});

export const manualImportRunsRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly limit: number }) => ({
		map: ({ importRuns }) => Result.succeed(importRuns),
		queries: {
			importRuns: selectedRows(importRun, {
				after: input.after,
				limit: input.limit,
				selection: runSelection(importRun),
				where: isNull(column(importRun, "integrationId")),
				orderBy: [descending(column(importRun, "createdAt")), ascending(column(importRun, "id"))],
			}),
		},
	}),
);

export const integrationImportRunsRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly integrationId: string;
		readonly after?: string | undefined;
	}) => ({
		map: ({ importRuns }) => Result.succeed(importRuns),
		queries: {
			importRuns: selectedRows(importRun, {
				after: input.after,
				limit: input.limit,
				selection: runSelection(importRun),
				where: eq(column(importRun, "integrationId"), literal(input.integrationId)),
				orderBy: [descending(column(importRun, "createdAt")), ascending(column(importRun, "id"))],
			}),
		},
	}),
);

export const importRunRecipe = defineRecipe((input: { readonly runId: string }) => ({
	map: ({ run: item }) => Result.succeed({ run: item }),
	queries: {
		run: selectedOptionalRow(run, {
			selection: runSelection(run),
			orderBy: [ascending(column(run, "id"))],
			where: eq(column(run, "id"), literal(input.runId)),
		}),
	},
}));

export type ImportRunSummary = ImportRunList["items"][number];
export type ImportRunDetail = Recipe.Success<typeof importRunRecipe>;
export type ImportRunList = Recipe.Success<typeof manualImportRunsRecipe>;

const issue = table("importIssue", "issue");

export const importIssuesRecipe = defineRecipe(
	(input: { readonly runId: string; readonly limit: number; readonly after?: string }) => ({
		map: ({ issues }) => Result.succeed(issues),
		queries: {
			issues: selectedRows(issue, {
				limit: input.limit,
				after: input.after,
				where: eq(column(issue, "runId"), literal(input.runId)),
				orderBy: [ascending(column(issue, "runId")), ascending(column(issue, "id"))],
				selection: {
					id: selectedField(column(issue, "id"), Schema.String),
					runId: selectedField(column(issue, "runId"), ImportRunId),
					data: selectedField(column(issue, "data"), IngestionIssue),
				},
			}),
		},
	}),
);

export type ImportIssuesPage = Recipe.Success<typeof importIssuesRecipe>;
