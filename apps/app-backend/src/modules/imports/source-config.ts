import type { CreateImportRunBody } from "./schemas";

export const allowedExtensionsBySource = {
	hevy: ["csv"],
	goodreads: ["csv"],
	hardcover: ["csv"],
	open_scale: ["csv"],
	strong_app: ["csv"],
	storygraph: ["csv"],
} satisfies Partial<Record<CreateImportRunBody["source"], string[]>>;

export const getKnownImportExtensions = () => [
	...new Set(Object.values(allowedExtensionsBySource).flat()),
];

export const buildFileInputSummary = (
	source: keyof typeof allowedExtensionsBySource,
): Record<string, unknown> => ({ source });

export const buildTraktInputSummary = (username: string): Record<string, unknown> => ({
	username,
	source: "trakt",
});
