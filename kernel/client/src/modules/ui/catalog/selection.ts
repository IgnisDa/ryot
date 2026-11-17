import {
	type DeclarationReference,
	definitionKey,
	type PluginPackageReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";

export type CatalogEntryGroup = { readonly key: string; readonly heading: string };

export type CatalogGroup = CatalogEntryGroup & { readonly entries: readonly CatalogEntry[] };

export type CatalogEntry = {
	readonly key: string;
	readonly name: string;
	readonly badge: string;
	readonly description: string;
	readonly isAvailable: boolean;
	readonly group: CatalogEntryGroup;
	readonly requirement: string | undefined;
};

type Translate = (message: Message) => Text;

/** The served plugin names of the client catalog, keyed by installation. */
export const pluginNamesByInstallation = (
	catalog: PluginClientCatalog,
): ReadonlyMap<string, Message> =>
	new Map(catalog.map(({ name, installationId }) => [installationId, name]));

const pluginInstallationLabel = (
	input: {
		readonly name: string;
		readonly packageId: null | PluginPackageId;
		readonly scope: null | PluginPackageReference["scope"];
	},
	t: Translate,
) =>
	t(
		kernelMessage("client.ui.catalog.installation", {
			name: input.name,
			scope: input.scope ?? "unavailable",
			packageId: input.packageId ?? t(kernelMessage("client.ui.catalog.unknown-package")),
		}),
	);

export const pluginCatalogGroup = (
	item: {
		readonly pluginName: Message | undefined;
		readonly reference: DeclarationReference;
		readonly packageId: null | PluginPackageId;
		readonly pluginScope: null | PluginPackageReference["scope"];
	},
	t: Translate,
): CatalogEntryGroup =>
	item.reference.owner.kind === "kernel"
		? { key: "kernel", heading: t(kernelMessage("client.ui.catalog.kernel-group")) }
		: {
				key: definitionKey("plugin", item.reference.owner),
				heading: pluginInstallationLabel(
					{
						scope: item.pluginScope,
						packageId: item.packageId,
						name: t(item.pluginName ?? kernelMessage("client.ui.catalog.untitled-plugin")),
					},
					t,
				),
			};

const matchesCatalogQuery = (entry: CatalogEntry, query: string) => {
	const needle = query.trim().toLowerCase();
	return (
		needle.length === 0 ||
		entry.name.toLowerCase().includes(needle) ||
		entry.description.toLowerCase().includes(needle)
	);
};

export const groupCatalogEntries = <Source>(
	sources: readonly Source[],
	query: string,
	toEntry: (source: Source) => CatalogEntry,
): readonly CatalogGroup[] => {
	const matched = sources.map(toEntry).filter((entry) => matchesCatalogQuery(entry, query));
	return [...new Set(matched.map((entry) => entry.group.key))].flatMap((key) => {
		const entries = matched
			.filter((entry) => entry.group.key === key)
			.sort((left, right) => left.name.localeCompare(right.name));
		const heading = entries.at(0)?.group.heading;
		return heading === undefined ? [] : [{ key, heading, entries }];
	});
};

export const availableCatalogEntries = (groups: readonly CatalogGroup[]) =>
	groups.flatMap((group) => group.entries.filter((entry) => entry.isAvailable));

export const findBySlug = <Item extends { readonly slug: string }>(
	items: readonly Item[],
	slug: string | undefined,
) => (slug === undefined ? undefined : items.find((item) => item.slug === slug));
