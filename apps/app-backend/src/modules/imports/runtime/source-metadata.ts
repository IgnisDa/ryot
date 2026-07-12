import { pluginConfigEnvironmentKey } from "@ryot/config";
import type { CreateImportRunBody } from "@ryot/contract/modules/imports/schemas";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { Effect } from "effect";

import { isPluginConfigKeyConfigured } from "#lib/infrastructure/sandbox-runtime/app-config";
import type { RegisteredImportSource } from "#modules/plugins/import-source-catalog";

export type ImportSourceFileInput = {
	bodyField: string;
	allowedExtensions: string[];
	required: boolean | undefined;
	payloadKey: string | undefined;
	artifactKey: string | undefined;
	uploadToken: string | undefined;
};

const isUploadTokenField = (field: string) =>
	field === "uploadToken" || field.endsWith("UploadToken");

const internalPayloadFields = new Set([
	"integrationContext",
	"integrationId",
	"integrationScriptSlug",
]);

export const readTrimmedBodyField = (
	body: CreateImportRunBody,
	field: string,
): string | undefined => {
	const value = Reflect.get(body, field);
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

export const registryImportSourceFileInputs = (
	source: RegisteredImportSource,
	body: CreateImportRunBody,
): ImportSourceFileInput[] => {
	if (source.input === "payload") {
		return [];
	}
	if (source.lot === "single") {
		return [
			{
				required: undefined,
				payloadKey: undefined,
				artifactKey: undefined,
				bodyField: "uploadToken",
				allowedExtensions: [...source.allowedFileExtensions],
				uploadToken: readTrimmedBodyField(body, "uploadToken"),
			},
		];
	}
	return source.artifacts.map((artifact) => ({
		payloadKey: artifact.key,
		artifactKey: artifact.key,
		required: artifact.required,
		bodyField: artifact.uploadTokenField,
		allowedExtensions: [...artifact.allowedFileExtensions],
		uploadToken: readTrimmedBodyField(body, artifact.uploadTokenField),
	}));
};

export const registryImportSourceInputError = (
	source: RegisteredImportSource,
	body: CreateImportRunBody,
) => {
	const fileInputs = registryImportSourceFileInputs(source, body);
	const declaredTokenFields = new Set(fileInputs.map(({ bodyField }) => bodyField));
	const undeclaredTokenField = Object.keys(body).find(
		(field) => isUploadTokenField(field) && !declaredTokenFields.has(field),
	);
	if (undeclaredTokenField) {
		return `Import source does not declare upload token field: ${undeclaredTokenField}`;
	}
	const artifactPayloadFields = new Set(
		fileInputs.flatMap(({ artifactKey, payloadKey }) =>
			[artifactKey, payloadKey].filter((field): field is string => field !== undefined),
		),
	);
	const reservedPayloadField = Object.keys(body).find(
		(field) => internalPayloadFields.has(field) || artifactPayloadFields.has(field),
	);
	if (reservedPayloadField) {
		return `Import source payload field is reserved: ${reservedPayloadField}`;
	}
	if (fileInputs.some(({ required, uploadToken }) => required !== false && !uploadToken)) {
		return "Import source requires an upload token";
	}
	if (fileInputs.length > 0 && fileInputs.every(({ uploadToken }) => !uploadToken)) {
		return "Import source requires at least one upload token";
	}
	return undefined;
};

export const registryImportSourceStartError = Effect.fn("registryImportSourceStartError")(
	function* (source: RegisteredImportSource) {
		const missing = yield* Effect.filter(source.requiredPluginConfigKeys, (key) =>
			isPluginConfigKeyConfigured({
				key,
				pluginSlug: source.pluginSlug,
				configSchema: source.configSchema,
			}).pipe(Effect.map((configured) => !configured)),
		);
		return missing.length === 0
			? undefined
			: `${source.name} importer is not configured. Set ${missing.map((key) => pluginConfigEnvironmentKey(source.pluginSlug, key)).join(", ")}.`;
	},
);

const payloadEntries = (body: CreateImportRunBody, source: RegisteredImportSource) => {
	const fileInputs = registryImportSourceFileInputs(source, body);
	const excludedFields = new Set(
		fileInputs.flatMap(({ artifactKey, bodyField, payloadKey }) =>
			[artifactKey, bodyField, payloadKey].filter((field): field is string => field !== undefined),
		),
	);
	return Object.entries(body).filter(
		([key]) => key !== "source" && !internalPayloadFields.has(key) && !excludedFields.has(key),
	);
};

export const buildImportSourcePayload = (
	body: CreateImportRunBody,
	source: RegisteredImportSource,
): Record<string, JsonValue> | undefined => {
	const payload = Object.fromEntries(
		payloadEntries(body, source).map(([key, value]) => [key, value]),
	);
	return Object.keys(payload).length > 0 ? payload : undefined;
};

const artifactSummaryKey = (key: string) =>
	`has${key.charAt(0).toUpperCase()}${key.slice(1).replace(/FilePath$/, "File")}`;

export const buildImportInputSummary = (
	body: CreateImportRunBody,
	source: RegisteredImportSource,
): Record<string, unknown> => {
	const summary: Record<string, unknown> = { source: body.source };
	if (source.input === "file" && source.lot === "single") {
		summary["hasFile"] = true;
	}
	if (source.input === "file" && source.lot === "named") {
		for (const artifact of source.artifacts) {
			summary[artifactSummaryKey(artifact.key)] =
				artifact.required || Boolean(readTrimmedBodyField(body, artifact.uploadTokenField));
		}
	}
	return summary;
};
