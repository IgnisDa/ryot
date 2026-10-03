import {
	ImportRunFailureSchema,
	ListedImportRun,
} from "@ryot-app/contract/modules/imports/schemas";
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
const failure = table("importRunFailure", "failure");
const inputSummary = ListedImportRun.fields.inputSummary;
const runSelection = (source: typeof importRun) => ({
	id: selectedField(column(source, "id"), ImportRunId),
	source: selectedField(column(source, "source"), Schema.String),
	progress: selectedField(column(source, "progress"), Schema.Finite),
	createdAt: selectedField(column(source, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(source, "updatedAt"), IsoDateString),
	failedItems: selectedField(column(source, "failedItems"), Schema.Finite),
	inputSummary: selectedField(column(source, "inputSummary"), inputSummary),
	importedItems: selectedField(column(source, "importedItems"), Schema.Finite),
	status: selectedField(column(source, "status"), ListedImportRun.fields.status),
	processedItems: selectedField(column(source, "processedItems"), Schema.Finite),
	startedAt: selectedField(column(source, "startedAt"), Schema.NullOr(IsoDateString)),
	finishedAt: selectedField(column(source, "finishedAt"), Schema.NullOr(IsoDateString)),
	totalItems: selectedField(column(source, "totalItems"), Schema.NullOr(Schema.Finite)),
	failureReason: selectedField(
		column(source, "failureReason"),
		Schema.NullOr(ListedImportRun.fields.failureReason),
	),
});
const failureSelection = {
	createdAt: selectedField(column(failure, "createdAt"), IsoDateString),
	id: selectedField(column(failure, "id"), ImportRunFailureSchema.fields.id),
	runId: selectedField(column(failure, "runId"), ImportRunFailureSchema.fields.runId),
	stage: selectedField(column(failure, "stage"), ImportRunFailureSchema.fields.stage),
	reason: selectedField(column(failure, "reason"), ImportRunFailureSchema.fields.reason),
	itemIndex: selectedField(column(failure, "itemIndex"), ImportRunFailureSchema.fields.itemIndex),
	sourceLabel: selectedField(
		column(failure, "sourceLabel"),
		ImportRunFailureSchema.fields.sourceLabel,
	),
	eventSchemaSlug: selectedField(
		column(failure, "eventSchemaSlug"),
		ImportRunFailureSchema.fields.eventSchemaSlug,
	),
	sourceIdentifier: selectedField(
		column(failure, "sourceIdentifier"),
		ImportRunFailureSchema.fields.sourceIdentifier,
	),
	entitySchemaSlug: selectedField(
		column(failure, "entitySchemaSlug"),
		ImportRunFailureSchema.fields.entitySchemaSlug,
	),
};

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

export const importRunRecipe = defineRecipe(
	(input: {
		readonly runId: string;
		readonly failureLimit: number;
		readonly failureAfter?: string | undefined;
	}) => ({
		map: ({ failures, run: item }) => Result.succeed({ failures, run: item }),
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
	}),
);

export type ImportRunSummary = ImportRunList["items"][number];
export type ImportRunFailureList = ImportRunDetail["failures"];
export type ImportRunDetail = Recipe.Success<typeof importRunRecipe>;
export type ImportRunFailure = ImportRunFailureList["items"][number];
export type ImportRunList = Recipe.Success<typeof manualImportRunsRecipe>;
