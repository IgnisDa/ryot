import {
	builtinMediaEntitySchemaSlugs,
	creatorGroupTargetSlugs,
	mediaGroupMemberSlugs,
	mediaGroupSlugs,
} from "./media-schema-slugs";

const outgoing = (slug: string) => ({ slug, direction: "outgoing" as const });

const credits = (target: string) =>
	(["person", "company"] as const).map((source) => ({
		slug: `${source}-to-${target}`,
		direction: "incoming" as const,
	}));

export const mediaChildEntityParents = {
	"show-season": { parentSchemaSlug: "show", relationshipSlug: "show-to-show-season" },
	"podcast-episode": {
		parentSchemaSlug: "podcast",
		relationshipSlug: "podcast-to-podcast-episode",
	},
	"show-episode": {
		parentSchemaSlug: "show-season",
		relationshipSlug: "show-season-to-show-episode",
	},
} as const;

export type MediaChildEntitySchemaSlug = keyof typeof mediaChildEntityParents;

export const isMediaChildEntitySchemaSlug = (slug: string): slug is MediaChildEntitySchemaSlug =>
	Object.hasOwn(mediaChildEntityParents, slug);

type MediaEntityEditor = {
	readonly deletable?: boolean;
	readonly relationships: ReadonlyArray<{
		readonly slug: string;
		readonly direction: "parent" | "outgoing" | "incoming";
	}>;
};

export const mediaEntityEditors: Readonly<Record<string, MediaEntityEditor>> = {
	...Object.fromEntries(
		builtinMediaEntitySchemaSlugs.map((slug) => [
			slug,
			{ relationships: [outgoing(`${slug}-to-genre`), ...credits(slug)] },
		]),
	),
	"video-game": {
		relationships: [
			outgoing("video-game-to-video-game"),
			outgoing("video-game-to-genre"),
			...credits("video-game"),
		],
	},
	...Object.fromEntries(
		mediaGroupSlugs.map((group) => [
			group,
			{
				relationships: [
					outgoing(`${group}-to-${mediaGroupMemberSlugs[group]}`),
					...(creatorGroupTargetSlugs.some((slug) => slug === group) ? credits(group) : []),
				],
			},
		]),
	),
	...Object.fromEntries(
		Object.entries(mediaChildEntityParents).map(([slug, { relationshipSlug }]) => [
			slug,
			{
				deletable: true,
				relationships: [{ slug: relationshipSlug, direction: "parent" as const }],
			},
		]),
	),
	genre: { relationships: [] },
	person: { relationships: [] },
	company: { relationships: [] },
};

export const mediaEntityCreateRoute = (entitySchemaSlug: string) => `/${entitySchemaSlug}/new`;

export const mediaEntityEditRoutePattern = (entitySchemaSlug: string) =>
	`/${entitySchemaSlug}/$entityId/edit`;

export const mediaEntityEditRoute = (entitySchemaSlug: string, entityId: string) =>
	`/${entitySchemaSlug}/${encodeURIComponent(entityId)}/edit`;

const childNumberProperties = ["seasonNumber", "episodeNumber"] as const;

export const mediaChildCreateSearch = (
	parentEntityId: string,
	initialProperties: Readonly<Record<string, number>>,
): Readonly<Record<string, string>> => ({
	parent: parentEntityId,
	...Object.fromEntries(
		childNumberProperties.flatMap((key) =>
			initialProperties[key] === undefined ? [] : [[key, String(initialProperties[key])]],
		),
	),
});

export const mediaChildCreateInput = (
	entitySchemaSlug: string,
	search: { readonly get: (key: string) => null | string },
) => {
	const parent = search.get("parent");
	if (!isMediaChildEntitySchemaSlug(entitySchemaSlug) || parent === null) {
		return {};
	}
	return {
		parents: { [mediaChildEntityParents[entitySchemaSlug].relationshipSlug]: parent },
		initialProperties: Object.fromEntries(
			childNumberProperties.flatMap((key) => {
				const value = Number(search.get(key) ?? Number.NaN);
				return Number.isInteger(value) && value >= 0 ? [[key, value]] : [];
			}),
		),
	};
};

const editorRoutes: Record<
	string,
	{ readonly kind: "edit" | "create"; readonly entitySchemaSlug: string }
> = {};
for (const entitySchemaSlug of Object.keys(mediaEntityEditors)) {
	editorRoutes[mediaEntityCreateRoute(entitySchemaSlug)] = { kind: "create", entitySchemaSlug };
	editorRoutes[mediaEntityEditRoutePattern(entitySchemaSlug)] = { kind: "edit", entitySchemaSlug };
}

export const mediaEntityEditorRoutes: Readonly<typeof editorRoutes> = editorRoutes;
