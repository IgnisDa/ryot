import {
	definitionKey,
	type DeclarationReference,
	type PluginPackageReference,
} from "@ryot-app/contract/modules/plugins/references";
import { pluginPackageSegments, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Match } from "effect";

export type CatalogEntryGroup = { readonly key: string; readonly heading: string };

export type CatalogEntry = {
	readonly key: string;
	readonly name: string;
	readonly badge: string;
	readonly description: string;
	readonly isAvailable: boolean;
	readonly group: CatalogEntryGroup;
	readonly requirement: string | undefined;
};

export type CatalogGroup = CatalogEntryGroup & { readonly entries: readonly CatalogEntry[] };

type CatalogSource = { readonly name: string; readonly description: string };

const UNTITLED_PLUGIN_HEADING = "Other";

export const pluginHeading = (packageId: PluginPackageId) => {
	const words = pluginPackageSegments(packageId)
		.name.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`);
	return words.length === 0 ? UNTITLED_PLUGIN_HEADING : words.join(" ");
};

const pluginScopeLabel = (scope: PluginPackageReference["scope"] | null) =>
	Match.value(scope).pipe(
		Match.when("system", () => "System"),
		Match.when("user", () => "Private"),
		Match.when(null, () => "Unavailable"),
		Match.exhaustive,
	);

const pluginInstallationLabel = (input: {
	readonly name: string;
	readonly packageId: PluginPackageId | null;
	readonly scope: PluginPackageReference["scope"] | null;
}) => `${input.name} · ${pluginScopeLabel(input.scope)} · ${input.packageId ?? "Unknown package"}`;

export const pluginCatalogGroup = (item: {
	readonly name: string;
	readonly reference: DeclarationReference;
	readonly packageId: PluginPackageId | null;
	readonly pluginScope: PluginPackageReference["scope"] | null;
}): CatalogEntryGroup =>
	item.reference.owner.kind === "kernel"
		? { key: "kernel", heading: "Ryot" }
		: {
				key: definitionKey("plugin", item.reference.owner),
				heading: pluginInstallationLabel({
					scope: item.pluginScope,
					packageId: item.packageId,
					name: item.packageId === null ? item.name : pluginHeading(item.packageId),
				}),
			};

const matchesCatalogQuery = (source: CatalogSource, query: string) => {
	const needle = query.trim().toLowerCase();
	return (
		needle.length === 0 ||
		source.name.toLowerCase().includes(needle) ||
		source.description.toLowerCase().includes(needle)
	);
};

export const groupCatalogEntries = <Source extends CatalogSource>(
	sources: readonly Source[],
	query: string,
	toEntry: (source: Source) => CatalogEntry,
): readonly CatalogGroup[] => {
	const matched = sources.filter((source) => matchesCatalogQuery(source, query)).map(toEntry);
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
