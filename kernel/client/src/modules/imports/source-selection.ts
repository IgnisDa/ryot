import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { getOrderedAppSchemaFieldEntries } from "@ryot-app/contract/schema/property-schema";

import type { ImportSourceItem } from "#/modules/imports/service";
import {
	pluginCatalogGroup,
	pluginHeading,
	type CatalogEntry,
} from "#/modules/ui/catalog/selection";

import { ingestionReadinessRequirement } from "./readiness-presentation";

export type ImportWizardSource = Pick<
	ImportSourceItem,
	"reference" | "slug" | "name" | "description" | "inputSchema" | "exportHelp"
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
	name: source.name,
	slug: importSourceKey(source),
	description: source.description,
	isAvailable: source.readiness.ready,
	badge: importSourceInputShape(source.inputSchema),
	requirement: ingestionReadinessRequirement(source.readiness, source.pluginScope),
	group:
		source.reference.owner.kind === "kernel"
			? { key: "kernel", heading: "Ryot" }
			: pluginCatalogGroup({
					scope: source.pluginScope,
					reference: source.reference,
					packageId: source.packageId,
					name: source.pluginSlug === null ? source.name : pluginHeading(source.pluginSlug),
				}),
});

export const importSourceChooseLabel = (entry: CatalogEntry) =>
	entry.isAvailable ? `Import from ${entry.name}` : `${entry.name} is unavailable`;

export const importSourceNames = (sources: readonly ImportSourceItem[]) =>
	new Map(sources.map((source) => [importSourceKey(source), source.name]));

export const importSourceKey = (source: Pick<ImportSourceItem, "reference">) =>
	definitionKey("import-source", source.reference.owner, source.reference.slug);
