import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { getOrderedAppSchemaFieldEntries } from "@ryot-app/contract/schema/property-schema";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

import type { ImportSourceItem } from "#/modules/imports/service";
import { type CatalogEntry, pluginCatalogGroup } from "#/modules/ui/catalog/selection";

import { ingestionReadinessRequirement } from "./readiness-presentation";
import { importRunSourceKey } from "./run-presentation";

export type ImportWizardSource = Pick<
	ImportSourceItem,
	"slug" | "name" | "reference" | "exportHelp" | "description" | "inputSchema"
>;

const uploadFieldExtensions = (schema: AppSchema) =>
	getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([, property]) =>
		property.type === "string" && property.format?.kind === "upload"
			? [property.format.allowedFileExtensions]
			: [],
	);

const fileShapeLabel = (
	t: (message: Message) => Text,
	formatters: Formatters,
	extensions: readonly string[],
) => {
	const labels = extensions.map((extension) => extension.toUpperCase());
	if (labels.length === 0) {
		return t(kernelMessage("client.imports.shape.file"));
	}
	return t(
		kernelMessage("client.imports.shape.file-of-type", {
			types: formatters.list({ type: "disjunction" }).format(labels),
		}),
	);
};

export const importSourceInputShape = (
	t: (message: Message) => Text,
	formatters: Formatters,
	schema: AppSchema,
) => {
	const uploads = uploadFieldExtensions(schema);
	const single = uploads.at(0);
	if (single === undefined) {
		return t(kernelMessage("client.imports.shape.server"));
	}
	return uploads.length === 1
		? fileShapeLabel(t, formatters, single)
		: t(kernelMessage("client.imports.shape.files", { count: uploads.length }));
};

export const importSourceEntry = (
	source: ImportSourceItem,
	t: (message: Message) => Text,
	formatters: Formatters,
	pluginNames: ReadonlyMap<string, Message>,
): CatalogEntry => ({
	name: t(source.name),
	key: importSourceKey(source),
	description: t(source.description),
	isAvailable: source.readiness.ready,
	badge: importSourceInputShape(t, formatters, source.inputSchema),
	requirement: ingestionReadinessRequirement(t, source.readiness, source.pluginScope),
	group: pluginCatalogGroup(
		{
			...source,
			pluginName:
				source.installationId === null ? undefined : pluginNames.get(source.installationId),
		},
		t,
	),
});

export const importSourceChooseLabel = (t: (message: Message) => Text, entry: CatalogEntry) =>
	t(
		kernelMessage(
			entry.isAvailable ? "client.imports.choose-source" : "client.ui.wizard.unavailable",
			{ name: entry.name },
		),
	);

export const importSourceNames = (
	sources: readonly ImportSourceItem[],
	t: (message: Message) => Text,
) =>
	new Map(
		sources.map((source) => [
			importRunSourceKey(source.installationId, source.slug),
			t(source.name),
		]),
	);

export const importSourceKey = (source: Pick<ImportSourceItem, "reference">) =>
	definitionKey("import-source", source.reference.owner, source.reference.slug);
