/**
 * Catalogs list the choices a wizard opens with, arranged under headings. Features map their own
 * row type onto `CatalogEntry` and share the grouping, searching and availability presentation from
 * here. Each entry names the group it belongs to, so what a heading means is the feature's business:
 * plugin-contributed catalogs group by contributing plugin, kernel-owned ones group by category.
 */
export type CatalogEntryGroup = { readonly key: string; readonly heading: string };

export type CatalogEntry = {
	readonly slug: string;
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

export const pluginHeading = (pluginSlug: string) => {
	const words = pluginSlug
		.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`);
	return words.length === 0 ? UNTITLED_PLUGIN_HEADING : words.join(" ");
};

export const pluginCatalogGroup = (pluginSlug: string): CatalogEntryGroup => ({
	key: pluginSlug,
	heading: pluginHeading(pluginSlug),
});

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
