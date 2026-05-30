import { config } from "~/lib/config";

import { fileImportRunSources, type CreateImportRunBody } from "../schemas";

const allowedExtensionsBySource = Object.fromEntries(
	fileImportRunSources.map((source) => [source, ["csv"]]),
) satisfies Partial<Record<CreateImportRunBody["source"], string[]>>;

export const getKnownImportExtensions = () => [
	...new Set(Object.values(allowedExtensionsBySource).flat()),
];

export const getAllowedExtensionsForSource = (source: CreateImportRunBody["source"]) =>
	(allowedExtensionsBySource as Partial<Record<CreateImportRunBody["source"], string[]>>)[source];

const sourceStartValidators: Partial<
	Record<CreateImportRunBody["source"], () => string | undefined>
> = {
	trakt: () =>
		config.importer.trakt.clientId
			? undefined
			: "Trakt importer is not configured. Set SERVER_IMPORTER_TRAKT_CLIENT_ID.",
};

export const getImportSourceStartError = (source: CreateImportRunBody["source"]) =>
	sourceStartValidators[source]?.();

export const buildInputSummary = (body: CreateImportRunBody): Record<string, unknown> => {
	const summary: Record<string, unknown> = { source: body.source };
	if ("username" in body) {
		summary.username = body.username;
	}
	return summary;
};

export const buildSourcePayload = (
	body: CreateImportRunBody,
): Record<string, unknown> | undefined => {
	if ("username" in body) {
		return { username: body.username };
	}
	return undefined;
};
