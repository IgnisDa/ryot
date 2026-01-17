import type { CreateImportRunBody } from "@ryot/contract/modules/imports/schemas";

import type { AppConfigValue } from "#lib/infrastructure/config/service";
import { isAppConfigKeyConfigured } from "#lib/infrastructure/sandbox-runtime/app-config";
import type { RegisteredImportSource } from "#modules/plugins/import-source-catalog";

export type ImportSourceFileInput = {
	bodyField: string;
	allowedExtensions: string[];
	required: boolean | undefined;
	payloadKey: string | undefined;
	uploadToken: string | undefined;
};

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
): ImportSourceFileInput[] =>
	source.input === "payload"
		? []
		: [
				{
					required: undefined,
					payloadKey: undefined,
					bodyField: "uploadToken",
					allowedExtensions: [...source.allowedFileExtensions],
					uploadToken: readTrimmedBodyField(body, "uploadToken"),
				},
			];

export const registryImportSourceStartError = (
	source: RegisteredImportSource,
	config: AppConfigValue,
): string | undefined => {
	const missing = source.requiredAppConfigKeys.filter(
		(key) => !isAppConfigKeyConfigured(config, key),
	);
	return missing.length === 0
		? undefined
		: `${source.name} importer is not configured. Set ${missing.join(", ")}.`;
};
