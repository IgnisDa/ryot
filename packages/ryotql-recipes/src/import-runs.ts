import { ListedImportRun } from "@ryot/contract/modules/imports/schemas";
import { importRunFailureStages } from "@ryot/contract/modules/imports/types";
import {
	DateFieldValue,
	JsonFieldValue,
	NullFieldValue,
	NumberFieldValue,
	RowsPageInfo,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import { EntitySchemaSlug, EventSchemaSlug, ImportRunId } from "@ryot/contract/schema/brands";
import { strictStruct } from "@ryot/contract/schema/utils";
import {
	ascending,
	column,
	descending,
	document,
	eq,
	field,
	isNull,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

const importRunStatus = ListedImportRun.fields.status;
const inputSummary = ListedImportRun.fields.inputSummary;
const importRunFailureStage = Schema.Literals([...importRunFailureStages]);
const nullableTextFieldValue = Schema.Union([TextFieldValue, NullFieldValue]);
const nullableDateFieldValue = Schema.Union([DateFieldValue, NullFieldValue]);
const nullableJsonFieldValue = Schema.Union([JsonFieldValue, NullFieldValue]);
const nullableNumberFieldValue = Schema.Union([NumberFieldValue, NullFieldValue]);

const importRunWire = strictStruct({
	id: TextFieldValue,
	source: TextFieldValue,
	createdAt: DateFieldValue,
	updatedAt: DateFieldValue,
	progress: NumberFieldValue,
	inputSummary: JsonFieldValue,
	failedItems: NumberFieldValue,
	importedItems: NumberFieldValue,
	processedItems: NumberFieldValue,
	startedAt: nullableDateFieldValue,
	finishedAt: nullableDateFieldValue,
	totalItems: nullableNumberFieldValue,
	errorSummary: nullableTextFieldValue,
	status: strictStruct({ value: importRunStatus, kind: Schema.Literal("text") }),
});

const importRunFailureWire = strictStruct({
	id: TextFieldValue,
	runId: TextFieldValue,
	message: TextFieldValue,
	createdAt: DateFieldValue,
	itemIndex: NumberFieldValue,
	context: nullableJsonFieldValue,
	sourceLabel: nullableTextFieldValue,
	eventSchemaSlug: nullableTextFieldValue,
	sourceIdentifier: nullableTextFieldValue,
	entitySchemaSlug: nullableTextFieldValue,
	stage: strictStruct({ value: importRunFailureStage, kind: Schema.Literal("text") }),
});

const importRunsResponse = strictStruct({
	data: strictStruct({ importRuns: rowsResultSchema(importRunWire) }),
});

const importRunResponse = strictStruct({
	data: strictStruct({
		run: rowsResultSchema(importRunWire),
		failures: rowsResultSchema(importRunFailureWire),
	}),
});

export const ImportRunSummary = strictStruct({
	inputSummary,
	id: ImportRunId,
	source: Schema.String,
	status: importRunStatus,
	progress: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	failedItems: Schema.Number,
	importedItems: Schema.Number,
	processedItems: Schema.Number,
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	totalItems: Schema.NullOr(Schema.Number),
	errorSummary: Schema.NullOr(Schema.String),
});
export type ImportRunSummary = typeof ImportRunSummary.Type;

export const ImportRunFailure = strictStruct({
	id: Schema.String,
	runId: ImportRunId,
	message: Schema.String,
	createdAt: Schema.String,
	itemIndex: Schema.Number,
	stage: importRunFailureStage,
	context: Schema.NullOr(inputSummary),
	sourceLabel: Schema.NullOr(Schema.String),
	sourceIdentifier: Schema.NullOr(Schema.String),
	eventSchemaSlug: Schema.NullOr(EventSchemaSlug),
	entitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
});
export type ImportRunFailure = typeof ImportRunFailure.Type;

export const ImportRunList = strictStruct({
	pageInfo: RowsPageInfo,
	items: Schema.Array(ImportRunSummary),
});
export type ImportRunList = typeof ImportRunList.Type;

export const ImportRunFailureList = strictStruct({
	pageInfo: RowsPageInfo,
	items: Schema.Array(ImportRunFailure),
});
export type ImportRunFailureList = typeof ImportRunFailureList.Type;

export const ImportRunDetail = strictStruct({
	failures: ImportRunFailureList,
	run: Schema.NullOr(ImportRunSummary),
});
export type ImportRunDetail = typeof ImportRunDetail.Type;

const normalizeDate = (fieldName: string, value: typeof DateFieldValue.Type) => {
	const parsed = DateTime.make(value.value);
	return Option.isSome(parsed)
		? Result.succeed(DateTime.formatIso(parsed.value))
		: Result.fail(new Error(`Expected RyotQL ${fieldName} to be a valid date`));
};

const normalizeNullableDate = (
	fieldName: string,
	value: typeof DateFieldValue.Type | typeof NullFieldValue.Type,
) => (value.kind === "null" ? Result.succeed(null) : normalizeDate(fieldName, value));

const decodeImportRun = (row: typeof importRunWire.Type) =>
	Result.all([
		normalizeDate("createdAt", row.createdAt),
		normalizeDate("updatedAt", row.updatedAt),
		normalizeNullableDate("startedAt", row.startedAt),
		normalizeNullableDate("finishedAt", row.finishedAt),
		Schema.decodeUnknownResult(inputSummary)(row.inputSummary.value),
	] as const).pipe(
		Result.map(
			([createdAt, updatedAt, startedAt, finishedAt, decodedInputSummary]) =>
				({
					createdAt,
					updatedAt,
					startedAt,
					finishedAt,
					source: row.source.value,
					status: row.status.value,
					progress: row.progress.value,
					inputSummary: decodedInputSummary,
					failedItems: row.failedItems.value,
					importedItems: row.importedItems.value,
					processedItems: row.processedItems.value,
					id: ImportRunId.make(row.id.value),
					totalItems: row.totalItems.kind === "number" ? row.totalItems.value : null,
					errorSummary: row.errorSummary.kind === "text" ? row.errorSummary.value : null,
				}) satisfies ImportRunSummary,
		),
	);

const decodeImportRunFailure = (row: typeof importRunFailureWire.Type) =>
	Result.all([
		normalizeDate("failure.createdAt", row.createdAt),
		row.context.kind === "null"
			? Result.succeed(null)
			: Schema.decodeUnknownResult(inputSummary)(row.context.value),
	] as const).pipe(
		Result.map(
			([createdAt, context]) =>
				({
					context,
					createdAt,
					id: row.id.value,
					stage: row.stage.value,
					message: row.message.value,
					itemIndex: row.itemIndex.value,
					runId: ImportRunId.make(row.runId.value),
					sourceLabel: row.sourceLabel.kind === "text" ? row.sourceLabel.value : null,
					sourceIdentifier:
						row.sourceIdentifier.kind === "text" ? row.sourceIdentifier.value : null,
					eventSchemaSlug:
						row.eventSchemaSlug.kind === "text"
							? EventSchemaSlug.make(row.eventSchemaSlug.value)
							: null,
					entitySchemaSlug:
						row.entitySchemaSlug.kind === "text"
							? EntitySchemaSlug.make(row.entitySchemaSlug.value)
							: null,
				}) satisfies ImportRunFailure,
		),
	);

const importRunFields = (importRun: ReturnType<typeof table>) => [
	field("id", column(importRun, "id")),
	field("source", column(importRun, "source")),
	field("status", column(importRun, "status")),
	field("progress", column(importRun, "progress")),
	field("createdAt", column(importRun, "createdAt")),
	field("updatedAt", column(importRun, "updatedAt")),
	field("failedItems", column(importRun, "failedItems")),
	field("inputSummary", column(importRun, "inputSummary")),
	field("importedItems", column(importRun, "importedItems")),
	field("processedItems", column(importRun, "processedItems")),
	field("startedAt", column(importRun, "startedAt")),
	field("finishedAt", column(importRun, "finishedAt")),
	field("totalItems", column(importRun, "totalItems")),
	field("errorSummary", column(importRun, "errorSummary")),
];

const importRunFailureFields = (failure: ReturnType<typeof table>) => [
	field("id", column(failure, "id")),
	field("runId", column(failure, "runId")),
	field("message", column(failure, "message")),
	field("createdAt", column(failure, "createdAt")),
	field("itemIndex", column(failure, "itemIndex")),
	field("stage", column(failure, "stage")),
	field("context", column(failure, "context")),
	field("sourceLabel", column(failure, "sourceLabel")),
	field("sourceIdentifier", column(failure, "sourceIdentifier")),
	field("eventSchemaSlug", column(failure, "eventSchemaSlug")),
	field("entitySchemaSlug", column(failure, "entitySchemaSlug")),
];

export const buildManualImportRunsDocument = (input: {
	readonly page: number;
	readonly limit: number;
}) => {
	const importRun = table("importRun", "importRun");
	return document({
		importRuns: rows(importRun, {
			page: input.page,
			limit: input.limit,
			fields: importRunFields(importRun),
			where: isNull(column(importRun, "integrationId")),
			orderBy: [descending(column(importRun, "createdAt")), ascending(column(importRun, "id"))],
		}),
	});
};

export const buildIntegrationImportRunsDocument = (input: {
	readonly page: number;
	readonly limit: number;
	readonly integrationId: string;
}) => {
	const importRun = table("importRun", "importRun");
	return document({
		importRuns: rows(importRun, {
			page: input.page,
			limit: input.limit,
			fields: importRunFields(importRun),
			where: eq(column(importRun, "integrationId"), literal(input.integrationId)),
			orderBy: [descending(column(importRun, "createdAt")), ascending(column(importRun, "id"))],
		}),
	});
};

export const buildImportRunDocument = (input: {
	readonly runId: string;
	readonly failurePage: number;
	readonly failureLimit: number;
}) => {
	const run = table("importRun", "run");
	const failure = table("importRunFailure", "failure");
	return document({
		run: rows(run, {
			page: 1,
			limit: 1,
			fields: importRunFields(run),
			orderBy: [ascending(column(run, "id"))],
			where: eq(column(run, "id"), literal(input.runId)),
		}),
		failures: rows(failure, {
			page: input.failurePage,
			limit: input.failureLimit,
			fields: importRunFailureFields(failure),
			where: eq(column(failure, "runId"), literal(input.runId)),
			orderBy: [ascending(column(failure, "createdAt")), ascending(column(failure, "id"))],
		}),
	});
};

const decodeImportRunsResult = Schema.decodeUnknownResult(importRunsResponse);
const decodeImportRunResult = Schema.decodeUnknownResult(importRunResponse);

export const decodeImportRunsResponse = (response: unknown) =>
	Result.flatMap(decodeImportRunsResult(response), ({ data }) =>
		Result.map(
			Result.all(data.importRuns.items.map(decodeImportRun)),
			(items) => ({ items, pageInfo: data.importRuns.pageInfo }) satisfies ImportRunList,
		),
	);

export const decodeImportRunResponse = (response: unknown) =>
	Result.flatMap(decodeImportRunResult(response), ({ data }) => {
		const [run] = data.run.items;
		return Result.all({
			run: run ? decodeImportRun(run) : Result.succeed(null),
			failures: Result.map(
				Result.all(data.failures.items.map(decodeImportRunFailure)),
				(items) => ({ items, pageInfo: data.failures.pageInfo }) satisfies ImportRunFailureList,
			),
		});
	});
