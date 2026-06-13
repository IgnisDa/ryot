import {
	ImportRunFailureReason,
	ListedImportRun,
} from "@ryot-app/contract/modules/imports/schemas";
import { importRunFailureStages } from "@ryot-app/contract/modules/imports/types";
import { EntitySchemaSlug, EventSchemaSlug, ImportRunId } from "@ryot-app/contract/schema/brands";
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
const failure = table("importRunFailure", "failure");
const inputSummary = ListedImportRun.fields.inputSummary;
const failureStage = Schema.Literals([...importRunFailureStages]);
const runSelection = (source: typeof importRun) => ({
	id: selectedField(column(source, "id"), ImportRunId),
	source: selectedField(column(source, "source"), Schema.String),
	progress: selectedField(column(source, "progress"), Schema.Number),
	createdAt: selectedField(column(source, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(source, "updatedAt"), IsoDateString),
	failedItems: selectedField(column(source, "failedItems"), Schema.Number),
	inputSummary: selectedField(column(source, "inputSummary"), inputSummary),
	importedItems: selectedField(column(source, "importedItems"), Schema.Number),
	status: selectedField(column(source, "status"), ListedImportRun.fields.status),
	processedItems: selectedField(column(source, "processedItems"), Schema.Number),
	startedAt: selectedField(column(source, "startedAt"), Schema.NullOr(IsoDateString)),
	finishedAt: selectedField(column(source, "finishedAt"), Schema.NullOr(IsoDateString)),
	totalItems: selectedField(column(source, "totalItems"), Schema.NullOr(Schema.Number)),
	failureReason: selectedField(
		column(source, "failureReason"),
		Schema.NullOr(ListedImportRun.fields.failureReason),
	),
});
const failureSelection = {
	id: selectedField(column(failure, "id"), Schema.String),
	runId: selectedField(column(failure, "runId"), ImportRunId),
	stage: selectedField(column(failure, "stage"), failureStage),
	createdAt: selectedField(column(failure, "createdAt"), IsoDateString),
	itemIndex: selectedField(column(failure, "itemIndex"), Schema.Number),
	reason: selectedField(column(failure, "reason"), ImportRunFailureReason),
	sourceLabel: selectedField(column(failure, "sourceLabel"), Schema.NullOr(Schema.String)),
	eventSchemaSlug: selectedField(
		column(failure, "eventSchemaSlug"),
		Schema.NullOr(EventSchemaSlug),
	),
	entitySchemaSlug: selectedField(
		column(failure, "entitySchemaSlug"),
		Schema.NullOr(EntitySchemaSlug),
	),
	sourceIdentifier: selectedField(
		column(failure, "sourceIdentifier"),
		Schema.NullOr(Schema.String),
	),
};

export const manualImportRunsRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly limit: number }) => ({
		queries: {
			importRuns: selectedRows(importRun, {
				after: input.after,
				limit: input.limit,
				selection: runSelection(importRun),
				where: isNull(column(importRun, "integrationId")),
				orderBy: [descending(column(importRun, "createdAt")), ascending(column(importRun, "id"))],
			}),
		},
		map: ({ importRuns }) => Result.succeed(importRuns),
	}),
);

export const integrationImportRunsRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly integrationId: string;
		readonly after?: string | undefined;
	}) => ({
		queries: {
			importRuns: selectedRows(importRun, {
				after: input.after,
				limit: input.limit,
				selection: runSelection(importRun),
				where: eq(column(importRun, "integrationId"), literal(input.integrationId)),
				orderBy: [descending(column(importRun, "createdAt")), ascending(column(importRun, "id"))],
			}),
		},
		map: ({ importRuns }) => Result.succeed(importRuns),
	}),
);

export const importRunRecipe = defineRecipe(
	(input: {
		readonly runId: string;
		readonly failureLimit: number;
		readonly failureAfter?: string | undefined;
	}) => ({
		queries: {
			run: selectedOptionalRow(run, {
				selection: runSelection(run),
				orderBy: [ascending(column(run, "id"))],
				where: eq(column(run, "id"), literal(input.runId)),
			}),
			failures: selectedRows(failure, {
				after: input.failureAfter,
				limit: input.failureLimit,
				selection: failureSelection,
				where: eq(column(failure, "runId"), literal(input.runId)),
				orderBy: [ascending(column(failure, "createdAt")), ascending(column(failure, "id"))],
			}),
		},
		map: ({ failures, run: item }) => Result.succeed({ failures, run: item }),
	}),
);

export type ImportRunSummary = ImportRunList["items"][number];
export type ImportRunFailureList = ImportRunDetail["failures"];
export type ImportRunDetail = Recipe.Success<typeof importRunRecipe>;
export type ImportRunFailure = ImportRunFailureList["items"][number];
export type ImportRunList = Recipe.Success<typeof manualImportRunsRecipe>;
