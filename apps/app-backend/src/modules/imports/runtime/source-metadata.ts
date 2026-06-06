import {
	importInternalPropertyNames,
	isImportUploadTokenField,
	type CreateImportRunBody,
} from "@ryot/contract/modules/imports/schemas";
import { pluginConfigEnvironmentKey } from "@ryot/contract/modules/plugins/plugin-config";
import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import { jsonValueSchema } from "@ryot/contract/modules/sandbox/wire";
import { TemporaryUploadToken } from "@ryot/contract/modules/uploads/schemas";
import {
	type AppPropertyDefinition,
	getOrderedAppSchemaFieldEntries,
} from "@ryot/contract/schema/property-schema";
import { Effect, Schema } from "effect";

import { isPluginConfigKeyConfigured } from "#lib/infrastructure/sandbox-runtime/app-config";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#lib/property-schema/property-schema-runtime";
import type { RegisteredImportSource } from "#modules/plugins/import-source-catalog";

export type ImportSourceFileInput = {
	key: string;
	uploadToken: TemporaryUploadToken;
	allowedExtensions: string[];
};

type UploadProperty = Extract<AppPropertyDefinition, { type: "string" }> & {
	readonly format: {
		readonly kind: "upload";
		readonly allowedFileExtensions: ReadonlyArray<string>;
	};
};

const uploadFields = (source: RegisteredImportSource) =>
	getOrderedAppSchemaFieldEntries(source.inputSchema.fields).filter(
		(entry): entry is [string, UploadProperty] =>
			entry[1].type === "string" && entry[1].format?.kind === "upload",
	);

const isJsonValue = Schema.is(jsonValueSchema);
const isTemporaryUploadToken = Schema.is(TemporaryUploadToken);

export const parseRegistryImportSourceInput = Effect.fn("parseRegistryImportSourceInput")(
	function* (source: RegisteredImportSource, body: CreateImportRunBody) {
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
		return isTemporaryUploadToken(uploadToken)
			? [
					{
						key,
						uploadToken,
						allowedExtensions: [...property.format.allowedFileExtensions],
					},
				]
			: [];
	});

export const registryImportSourceMissingConfigKeys = Effect.fn(
	"registryImportSourceMissingConfigKeys",
)(function* (source: RegisteredImportSource) {
	const missing = yield* Effect.filter(source.requiredPluginConfigKeys, (key) =>
		isPluginConfigKeyConfigured({
			key,
			pluginSlug: source.pluginSlug,
			configSchema: source.configSchema,
		}).pipe(Effect.map((configured) => !configured)),
	);
	return missing.map((key) => pluginConfigEnvironmentKey(source.pluginSlug, key));
});

export const registryImportSourceStartError = Effect.fn("registryImportSourceStartError")(
	function* (source: RegisteredImportSource) {
		const missing = yield* registryImportSourceMissingConfigKeys(source);
		return missing.length === 0
			? undefined
			: `${source.name} importer is not configured. Set ${missing.join(", ")}.`;
	},
);

export const buildImportSourcePayload = (
	properties: Readonly<Record<string, unknown>>,
	source: RegisteredImportSource,
): Record<string, JsonValue> | undefined => {
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
