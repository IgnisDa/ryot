import type { ListedImportSource } from "@ryot-app/contract/modules/imports/schemas";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { getOrderedAppSchemaFieldEntries } from "@ryot-app/contract/schema/property-schema";

import { pluginCatalogGroup, type CatalogEntry } from "#/modules/ui/catalog/selection";

export type ImportWizardSource = Pick<
	ListedImportSource,
	"slug" | "name" | "description" | "inputSchema" | "exportHelp"
>;

const SERVER_INPUT_SHAPE = "Server";

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

const importSourceRequirement = (source: ListedImportSource) => {
	if (source.isStartable) {
		return undefined;
	}
	return source.missingPluginConfigKeys.length === 0
		? "This service is not ready on your server yet."
		: `Set ${source.missingPluginConfigKeys.join(", ")} on your server to use this.`;
};

export const importSourceEntry = (source: ListedImportSource): CatalogEntry => ({
	slug: source.slug,
	name: source.name,
	description: source.description,
	isAvailable: source.isStartable,
	group: pluginCatalogGroup(source.pluginSlug),
	requirement: importSourceRequirement(source),
	badge: importSourceInputShape(source.inputSchema),
});

export const importSourceChooseLabel = (entry: CatalogEntry) =>
	entry.isAvailable ? `Import from ${entry.name}` : `${entry.name} is unavailable`;

export const importSourceNames = (sources: readonly ListedImportSource[]) =>
	new Map(sources.map((source) => [source.slug, source.name]));
