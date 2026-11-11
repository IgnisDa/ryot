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
	type Recipe,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
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
	pluginInstallationId: selectedField(
		column(source, "pluginInstallationId"),
		Schema.NullOr(Schema.String),
	),
	failureReason: selectedField(
		column(source, "failureReason"),
		Schema.NullOr(ListedImportRun.fields.failureReason),
	),
});

export const manualImportRunsRecipe = defineRecipe({
	map: ({ importRuns }) => Result.succeed(importRuns),
	queries: {
		importRuns: selectedRows(importRun, {
			limit: 20,
			maxLimit: 1000,
			selection: runSelection(importRun),
			where: isNull(column(importRun, "integrationId")),
			orderBy: [descending(column(importRun, "createdAt")), ascending(column(importRun, "id"))],
		}),
	},
});

export const integrationImportRunsRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			integrationId: {
				type: "string",
				label: "integrationId",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ importRuns }) => Result.succeed(importRuns),
		queries: {
			importRuns: selectedRows(importRun, {
				limit: 20,
				maxLimit: 1000,
				selection: runSelection(importRun),
				where: eq(column(importRun, "integrationId"), recipeParameters.value("integrationId")),
				orderBy: [descending(column(importRun, "createdAt")), ascending(column(importRun, "id"))],
			}),
		},
	});
})();

export const importRunRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			runId: {
				type: "string",
				label: "runId",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ run: item }) => Result.succeed({ run: item }),
		queries: {
			run: selectedOptionalRow(run, {
				selection: runSelection(run),
				orderBy: [ascending(column(run, "id"))],
				where: eq(column(run, "id"), recipeParameters.value("runId")),
			}),
		},
	});
})();

export type ImportRunSummary = ImportRunList["items"][number];
export type ImportRunDetail = Recipe.Success<typeof importRunRecipe>;
export type ImportRunList = Recipe.Success<typeof manualImportRunsRecipe>;

const issue = table("importIssue", "issue");

export const importIssuesRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			runId: {
				type: "string",
				label: "runId",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ issues }) => Result.succeed(issues),
		queries: {
			issues: selectedRows(issue, {
				limit: 20,
				maxLimit: 1000,

				where: eq(column(issue, "runId"), recipeParameters.value("runId")),
				orderBy: [ascending(column(issue, "runId")), ascending(column(issue, "id"))],
				selection: {
					id: selectedField(column(issue, "id"), Schema.String),
					runId: selectedField(column(issue, "runId"), ImportRunId),
					data: selectedField(column(issue, "data"), IngestionIssue),
				},
			}),
		},
	});
})();

export type ImportIssuesPage = Recipe.Success<typeof importIssuesRecipe>;
