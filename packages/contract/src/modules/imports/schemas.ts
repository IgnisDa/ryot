import { Schema } from "effect";

import { ImportRunId } from "../../schema/brands";
import { RunStatus } from "../../schema/run-status";
import { PluginImportSource } from "../plugins/manifest";
import { jsonValueSchema } from "../sandbox/wire";

export const importInternalPropertyNames: ReadonlySet<string> = new Set([
	"integrationId",
	"integrationContext",
	"integrationScriptSlug",
]);

export const isImportUploadTokenField = (field: string) =>
	field === "uploadToken" || field.endsWith("UploadToken");

const InputSummary = Schema.Record(Schema.String, Schema.Unknown);

export const ListedImportSource = Schema.Struct({
	...PluginImportSource.fields,
	pluginSlug: Schema.String,
	isStartable: Schema.Boolean,
	missingPluginConfigKeys: Schema.Array(Schema.String),
});

export type ListedImportSource = typeof ListedImportSource.Type;

export const ListedImportRun = Schema.Struct({
	id: ImportRunId,
	status: RunStatus,
	source: Schema.String,
	progress: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	failedItems: Schema.Number,
	inputSummary: InputSummary,
	importedItems: Schema.Number,
	processedItems: Schema.Number,
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	totalItems: Schema.NullOr(Schema.Number),
	errorSummary: Schema.NullOr(Schema.String),
});

export type ListedImportRun = typeof ListedImportRun.Type;

export const CreateImportRunBody = Schema.StructWithRest(
	Schema.Struct({ source: Schema.NonEmptyString }),
	[Schema.Record(Schema.String, jsonValueSchema)],
).pipe(Schema.annotate({ identifier: "CreateImportRunBody" }));

export type CreateImportRunBody = typeof CreateImportRunBody.Type;
