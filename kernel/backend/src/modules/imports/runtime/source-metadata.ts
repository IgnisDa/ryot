import {
	type CreateImportRunBody,
	importInternalPropertyNames,
	isImportUploadTokenField,
} from "@ryot-app/contract/modules/imports/schemas";
import { evaluateIngestionReadiness } from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	type AppPropertyDefinition,
	getOrderedAppSchemaFieldEntries,
} from "@ryot-app/contract/schema/property-schema";
import { Effect, Schema } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#modules/definitions/properties/runtime";
import type { RegisteredImportSource } from "#modules/plugins/catalog/import-sources";

export type ImportSourceFileInput = {
	key: string;
	uploadToken: string;
	allowedExtensions: string[];
};

type UploadProperty = Extract<AppPropertyDefinition, { type: "string" }> & {
	readonly format: {
		readonly kind: "upload";
		readonly allowedFileExtensions: ReadonlyArray<string>;
	};
};

const uploadFields = (source: Pick<RegisteredImportSource, "inputSchema">) =>
	getOrderedAppSchemaFieldEntries(source.inputSchema.fields).filter(
		(entry): entry is [string, UploadProperty] =>
			entry[1].type === "string" && entry[1].format?.kind === "upload",
	);

const isJsonValue = Schema.is(JsonValue);

export const parseRegistryImportSourceInput = Effect.fn("parseRegistryImportSourceInput")(
	function* (source: Pick<RegisteredImportSource, "inputSchema">, body: CreateImportRunBody) {
		const declaredUploadFields = new Set(uploadFields(source).map(([field]) => field));
		const undeclaredTokenField = Object.keys(body).find(
			(field) => isImportUploadTokenField(field) && !declaredUploadFields.has(field),
		);
		if (undeclaredTokenField) {
			return yield* Effect.fail(
				`Import source does not declare upload token field: ${undeclaredTokenField}`,
			);
		}
		const reservedPayloadField = Object.keys(body).find((field) =>
			importInternalPropertyNames.has(field),
		);
		if (reservedPayloadField) {
			return yield* Effect.fail(`Import source payload field is reserved: ${reservedPayloadField}`);
		}

		const { source: _source, ...properties } = body;
		return yield* parseAppSchemaProperties({
			properties,
			kind: "Import source input",
			propertiesSchema: source.inputSchema,
		}).pipe(
			Effect.mapError(
				(error) => `Import source input is invalid: ${formatPropertyIssues(error.issues)}`,
			),
		);
	},
);

export const registryImportSourceFileInputs = (
	source: RegisteredImportSource,
	properties: Readonly<Record<string, unknown>>,
): ImportSourceFileInput[] =>
	uploadFields(source).flatMap(([key, property]) => {
		const uploadToken = properties[key];
		return typeof uploadToken === "string" && uploadToken.length > 0
			? [{ key, uploadToken, allowedExtensions: [...property.format.allowedFileExtensions] }]
			: [];
	});

export const registryImportSourceReadiness = (
	source: RegisteredImportSource,
	settings?: Readonly<Record<string, unknown>>,
) =>
	evaluateIngestionReadiness({
		settings,
		kind: "workflow",
		sourcePlan: source.plan,
		operation: source.workflowSlug,
		metadata: source.readinessMetadata,
		settingsSchema: source.inputSchema,
	});

export const registryImportSourceMissingConfigKeys = (source: RegisteredImportSource) =>
	registryImportSourceReadiness(source).blockReasons.map(({ key }) =>
		source.pluginScope === "system" ? pluginConfigEnvironmentKey(source.packageId, key) : key,
	);

export const buildImportSourcePayload = (
	properties: Readonly<Record<string, unknown>>,
	source: RegisteredImportSource,
): undefined | Record<string, JsonValue> => {
	const fileInputs = registryImportSourceFileInputs(source, properties);
	const uploadFieldKeys = new Set(fileInputs.map(({ key }) => key));
	const payload = Object.fromEntries(
		Object.entries(properties).filter(
			(entry): entry is [string, JsonValue] =>
				!uploadFieldKeys.has(entry[0]) && isJsonValue(entry[1]),
		),
	);
	for (const fileInput of fileInputs) {
		payload[fileInput.key] = fileInput.key;
	}
	return Object.keys(payload).length > 0 ? payload : undefined;
};

export const buildImportInputSummary = (
	source: string,
	fileNames: Readonly<Record<string, string>>,
): Record<string, unknown> => ({
	source,
	...(Object.keys(fileNames).length > 0 ? { fileNames } : {}),
});
