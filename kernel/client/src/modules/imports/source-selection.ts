import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { getOrderedAppSchemaFieldEntries } from "@ryot-app/contract/schema/property-schema";

import type { ImportSourceItem } from "#/modules/imports/service";
import { pluginCatalogGroup, type CatalogEntry } from "#/modules/ui/catalog/selection";

import { ingestionReadinessRequirement } from "./readiness-presentation";

export type ImportWizardSource = Pick<
	ImportSourceItem,
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

export const importSourceEntry = (source: ImportSourceItem): CatalogEntry => ({
	slug: source.slug,
	name: source.name,
	description: source.description,
	isAvailable: source.readiness.ready,
	badge: importSourceInputShape(source.inputSchema),
	requirement: ingestionReadinessRequirement(source.readiness, source.pluginScope),
	group:
		source.pluginSlug === null
			? { key: "kernel", heading: "Ryot" }
			: pluginCatalogGroup(source.pluginSlug),
});

export const importSourceChooseLabel = (entry: CatalogEntry) =>
	entry.isAvailable ? `Import from ${entry.name}` : `${entry.name} is unavailable`;

export const importSourceNames = (sources: readonly ImportSourceItem[]) =>
	new Map(sources.map((source) => [source.slug, source.name]));
