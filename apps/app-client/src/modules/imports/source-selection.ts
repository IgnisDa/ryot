import type { ListedImportSource } from "@ryot/contract/modules/imports/schemas";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { getOrderedAppSchemaFieldEntries } from "@ryot/contract/schema/property-schema";

export type ImportWizardSource = Pick<
	ListedImportSource,
	"slug" | "name" | "description" | "inputSchema" | "exportHelp"
>;

export type ImportSourceRow = {
	readonly slug: string;
	readonly name: string;
	readonly inputShape: string;
	readonly description: string;
	readonly isStartable: boolean;
	readonly missingConfigKeys: readonly string[];
};

export type ImportSourceGroup = {
	readonly heading: string;
	readonly pluginSlug: string;
	readonly sources: readonly ImportSourceRow[];
};

const SERVER_INPUT_SHAPE = "Server";

const UNTITLED_PLUGIN_HEADING = "Other";

const uploadFieldExtensions = (schema: AppSchema) =>
	getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([, property]) =>
		property.type === "string" && property.format?.kind === "upload"
			? [property.format.allowedFileExtensions]
			: [],
	);

const fileShapeLabel = (extensions: readonly string[]) => {
	const labels = extensions.map((extension) => extension.toUpperCase());
	const last = labels.at(-1);
	if (last === undefined) {
		return "File";
	}
	return labels.length < 2 ? `${last} file` : `${labels.slice(0, -1).join(", ")} or ${last} file`;
};

export const importSourceInputShape = (schema: AppSchema) => {
	const uploads = uploadFieldExtensions(schema);
	const single = uploads.at(0);
	if (single === undefined) {
		return SERVER_INPUT_SHAPE;
	}
	return uploads.length === 1 ? fileShapeLabel(single) : `${uploads.length} files`;
};

export const importPluginHeading = (pluginSlug: string) => {
	const words = pluginSlug
		.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`);
	return words.length === 0 ? UNTITLED_PLUGIN_HEADING : words.join(" ");
};

export const importSourceRow = (source: ListedImportSource): ImportSourceRow => ({
	slug: source.slug,
	name: source.name,
	isStartable: source.isStartable,
	description: source.description,
	missingConfigKeys: source.missingPluginConfigKeys,
	inputShape: importSourceInputShape(source.inputSchema),
});

export const importSourceRequirement = (source: ImportSourceRow) => {
	if (source.isStartable) {
		return undefined;
	}
	return source.missingConfigKeys.length === 0
		? "This service is not ready on your server yet."
		: `Set ${source.missingConfigKeys.join(", ")} on your server to use this.`;
};

const matchesImportSourceQuery = (source: ListedImportSource, query: string) => {
	const needle = query.trim().toLowerCase();
	return (
		needle.length === 0 ||
		source.name.toLowerCase().includes(needle) ||
		source.description.toLowerCase().includes(needle)
	);
};

export const groupImportSources = (
	sources: readonly ListedImportSource[],
	query: string,
): readonly ImportSourceGroup[] => {
	const matched = sources.filter((source) => matchesImportSourceQuery(source, query));
	return [...new Set(matched.map((source) => source.pluginSlug))].map((pluginSlug) => ({
		pluginSlug,
		heading: importPluginHeading(pluginSlug),
		sources: matched
			.filter((source) => source.pluginSlug === pluginSlug)
			.map(importSourceRow)
			.sort((left, right) => left.name.localeCompare(right.name)),
	}));
};

export const startableImportSources = (groups: readonly ImportSourceGroup[]) =>
	groups.flatMap((group) => group.sources.filter((source) => source.isStartable));

export const findImportSource = <Source extends { readonly slug: string }>(
	sources: readonly Source[],
	slug: string | undefined,
) => (slug === undefined ? undefined : sources.find((source) => source.slug === slug));
