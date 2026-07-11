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

const normalizeSourceApiUrl = (value: string) => {
	const parsed = new URL(value.trim());
	if (!parsed.protocol || !["http:", "https:"].includes(parsed.protocol)) {
		throw new Error("Import source URL must use http or https");
	}
	parsed.hash = "";
	parsed.search = "";
	parsed.password = "";
	parsed.username = "";
	return parsed.toString().replace(/\/+$/, "");
};

const getSourceApiHost = (value: string) => new URL(normalizeSourceApiUrl(value)).host;

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

const payloadEntries = (body: CreateImportRunBody) =>
	Object.entries(body).filter(
		([key, value]) =>
			key !== "source" &&
			key !== "uploadToken" &&
			!key.endsWith("UploadToken") &&
			value !== undefined &&
			value !== false,
	);

export const buildImportSourcePayload = (
	body: CreateImportRunBody,
): Record<string, JsonValue> | undefined => {
	const payload = Object.fromEntries(
		payloadEntries(body).flatMap(([key, value]) => {
			if (typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") {
				return [];
			}
			if (key === "apiUrl" && typeof value === "string") {
				return [[key, normalizeSourceApiUrl(value)]];
			}
			if (key === "profileName" && typeof value === "string") {
				const trimmed = value.trim();
				return trimmed ? [[key, trimmed]] : [];
			}
			return [[key, value]];
		}),
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
	if ("apiUrl" in body) {
		summary["host"] = getSourceApiHost(body.apiUrl);
		if ("allowInsecureConnections" in body && body.allowInsecureConnections) {
			summary["allowInsecureConnections"] = true;
		}
	}
	if ("collection" in body) {
		summary["collection"] = body.collection;
	}
	if ("profileName" in body) {
		summary["hasExportFile"] = true;
		summary["hasProfileName"] = Boolean(body.profileName?.trim());
	}
	if ("username" in body && !("apiUrl" in body)) {
		summary["username"] = body.username;
	}
	if (source.input === "file" && source.lot === "named") {
		for (const artifact of source.artifacts) {
			summary[artifactSummaryKey(artifact.key)] =
				artifact.required || Boolean(readTrimmedBodyField(body, artifact.uploadTokenField));
		}
	}
	return summary;
};
