import type { CreateImportRunBody } from "../schemas";

type ImportSourceFileDefinition = {
	bodyField: string;
	required?: boolean;
	payloadKey?: string;
	allowedExtensions: string[];
};

const sourceFileDefinitions: Partial<
	Record<CreateImportRunBody["source"], ImportSourceFileDefinition[]>
> = {
	hevy: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	open_scale: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	strong_app: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
};

const getBodyString = (body: CreateImportRunBody, field: string): string | undefined => {
	const value = (body as Record<string, unknown>)[field];
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

export const getKnownImportExtensions = (): string[] => [
	...new Set(
		Object.values(sourceFileDefinitions)
			.flat()
			.flatMap((source) => source.allowedExtensions),
	),
];

export const getImportSourceFileInputs = (body: CreateImportRunBody) =>
	(sourceFileDefinitions[body.source] ?? []).map((definition) => ({
		required: definition.required,
		bodyField: definition.bodyField,
		payloadKey: definition.payloadKey,
		allowedExtensions: definition.allowedExtensions,
		uploadToken: getBodyString(body, definition.bodyField),
	}));

export const getImportSourceStartError = (
	_source: CreateImportRunBody["source"],
): string | undefined => undefined;

export const buildInputSummary = (body: CreateImportRunBody): Record<string, unknown> => ({
	source: body.source,
});
