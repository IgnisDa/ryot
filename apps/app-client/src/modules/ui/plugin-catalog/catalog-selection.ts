/**
 * Both catalogs list services contributed by server-side plugins, grouped by the plugin that
 * contributes them. Features map their own row type onto `CatalogEntry` and share the grouping,
 * searching and availability presentation from here.
 */
export type CatalogEntry = {
	readonly slug: string;
	readonly name: string;
	readonly badge: string;
	readonly description: string;
	readonly isAvailable: boolean;
	readonly requirement: string | undefined;
};

export type CatalogGroup = {
	readonly heading: string;
	readonly pluginSlug: string;
	readonly entries: readonly CatalogEntry[];
};

type CatalogSource = {
	readonly name: string;
	readonly pluginSlug: string;
	readonly description: string;
};

const UNTITLED_PLUGIN_HEADING = "Other";

export const pluginHeading = (pluginSlug: string) => {
	const words = pluginSlug
		.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`);
	return words.length === 0 ? UNTITLED_PLUGIN_HEADING : words.join(" ");
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
	const matched = sources.filter((source) => matchesCatalogQuery(source, query));
	return [...new Set(matched.map((source) => source.pluginSlug))].map((pluginSlug) => ({
		pluginSlug,
		heading: pluginHeading(pluginSlug),
		entries: matched
			.filter((source) => source.pluginSlug === pluginSlug)
			.map(toEntry)
			.sort((left, right) => left.name.localeCompare(right.name)),
	}));
};

export const availableCatalogEntries = (groups: readonly CatalogGroup[]) =>
	groups.flatMap((group) => group.entries.filter((entry) => entry.isAvailable));

export const findBySlug = <Item extends { readonly slug: string }>(
	items: readonly Item[],
	slug: string | undefined,
) => (slug === undefined ? undefined : items.find((item) => item.slug === slug));
