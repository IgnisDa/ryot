import type { AppSchema } from "@ryot/contract/schema/property-schema";

import { slugify } from "../shared/slug";
import { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";

type BuiltinRelationshipSchema = {
	slug: string;
	name: string;
	propertiesSchema: AppSchema;
	sourceEntitySchemaSlug: string | null;
	targetEntitySchemaSlug: string | null;
};

const groupRolesPropertiesSchema = {
	fields: {
		order: {
			label: "Order",
			type: "number" as const,
			description: "Position of this media item within the group (1-based)",
		},
		roles: {
			label: "Roles",
			type: "array" as const,
			description: "Roles this group filled in this media",
			items: {
				label: "Role",
				type: "string" as const,
				description: "A specific role name",
			},
		},
	},
};

const buildCreditRelationshipSchemas = (input: {
	sourceSlug: string;
	orderDescription: string;
	rolesDescription: string;
	rolesItemDescription: string;
	characterDescription?: string;
	targetEntitySchemaSlugs?: ReadonlyArray<string>;
}) =>
	(input.targetEntitySchemaSlugs ?? builtinMediaEntitySchemaSlugs).map((mediaSlug) => ({
		sourceEntitySchemaSlug: input.sourceSlug,
		targetEntitySchemaSlug: mediaSlug,
		slug: slugify(`${input.sourceSlug} to ${mediaSlug}`),
		name: `${input.sourceSlug.charAt(0).toUpperCase() + input.sourceSlug.slice(1)} to ${mediaSlug.charAt(0).toUpperCase() + mediaSlug.slice(1)}`,
		propertiesSchema: {
			fields: {
				...(input.characterDescription !== undefined
					? {
							character: {
								label: "Character",
								type: "string" as const,
								description: input.characterDescription,
							},
						}
					: {}),
				order: {
					label: "Order",
					type: "number" as const,
					description: input.orderDescription,
				},
				roles: {
					label: "Roles",
					type: "array" as const,
					description: input.rolesDescription,
					items: {
						label: "Role",
						type: "string" as const,
						description: input.rolesItemDescription,
					},
				},
			},
		},
	}));

export const builtinRelationshipSchemas = (): BuiltinRelationshipSchema[] => [
	{
		slug: "in-library",
		name: "In Library",
		sourceEntitySchemaSlug: null,
		targetEntitySchemaSlug: "library",
		propertiesSchema: {
			fields: {
				owned: {
					label: "Owned",
					type: "boolean" as const,
					description: "Whether the user owns this item",
				},
				ownershipSources: {
					type: "array" as const,
					label: "Ownership Sources",
					description: "Integrations or sources that reported ownership",
					items: {
						label: "Source",
						type: "string" as const,
						description: "An integration or source that reported ownership",
					},
				},
				ownershipSyncedAt: {
					type: "datetime" as const,
					label: "Ownership Synced At",
					description: "When ownership was last synced from an external source",
				},
			},
		},
	},
	{
		slug: "media-monitoring",
		name: "Media Monitoring",
		sourceEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "library",
	},
	{
		slug: "media-suggestion",
		name: "Media Suggestion",
		sourceEntitySchemaSlug: null,
		targetEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
	},
	{
		slug: "media-trending",
		name: "Media Trending",
		sourceEntitySchemaSlug: null,
		targetEntitySchemaSlug: null,
		propertiesSchema: {
			fields: {
				rank: {
					label: "Rank",
					type: "number" as const,
					description: "Provider trend rank, ascending from the top item",
				},
				fetchedAt: {
					label: "Fetched At",
					type: "datetime" as const,
					description: "When this trend entry was refreshed",
				},
			},
		},
	},
	{
		slug: "show-to-show-season",
		name: "Show to Show Season",
		sourceEntitySchemaSlug: "show",
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "show-season",
	},
	{
		propertiesSchema: { fields: {} },
		slug: "show-season-to-show-episode",
		name: "Show Season to Show Episode",
		sourceEntitySchemaSlug: "show-season",
		targetEntitySchemaSlug: "show-episode",
	},
	{
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: "podcast",
		slug: "podcast-to-podcast-episode",
		name: "Podcast to Podcast Episode",
		targetEntitySchemaSlug: "podcast-episode",
	},
	...buildCreditRelationshipSchemas({
		sourceSlug: "person",
		targetEntitySchemaSlugs: builtinMediaEntitySchemaSlugs,
		characterDescription: "Character played by this person in this production",
		orderDescription: "Display order of this person in the production credits",
		rolesItemDescription: "A specific role name (e.g. Director, Actor, Writer)",
		rolesDescription: "Roles this person filled in this production (e.g. Director, Actor, Writer)",
	}),
	...buildCreditRelationshipSchemas({
		sourceSlug: "company",
		targetEntitySchemaSlugs: builtinMediaEntitySchemaSlugs,
		orderDescription: "Display order of this company in the production credits",
		rolesItemDescription: "A specific role name (e.g. Developer, Publisher, Studio)",
		rolesDescription:
			"Roles this company filled in this production (e.g. Developer, Publisher, Studio)",
	}),
	{
		slug: "person-to-music-group",
		name: "Person to Music Group",
		sourceEntitySchemaSlug: "person",
		targetEntitySchemaSlug: "music-group",
		propertiesSchema: {
			fields: {
				order: {
					label: "Order",
					type: "number" as const,
					description: "Display order of this person in the group credits",
				},
				roles: {
					label: "Roles",
					type: "array" as const,
					description: "Roles this person filled in this group (e.g. Artist)",
					items: {
						label: "Role",
						type: "string" as const,
						description: "A specific role name (e.g. Artist)",
					},
				},
			},
		},
	},
	{
		sourceEntitySchemaSlug: "person",
		slug: "person-to-video-game-group",
		name: "Person to Video Game Group",
		targetEntitySchemaSlug: "video-game-group",
		propertiesSchema: {
			fields: {
				order: {
					label: "Order",
					type: "number" as const,
					description: "Display order of this person in the group credits",
				},
				roles: {
					label: "Roles",
					type: "array" as const,
					description: "Roles this person filled in this group (e.g. Developer)",
					items: {
						label: "Role",
						type: "string" as const,
						description: "A specific role name (e.g. Developer)",
					},
				},
			},
		},
	},
	...buildCreditRelationshipSchemas({
		sourceSlug: "company",
		targetEntitySchemaSlugs: ["music-group", "video-game-group"],
		orderDescription: "Display order of this company in the group credits",
		rolesItemDescription: "A specific role name (e.g. Label, Publisher)",
		rolesDescription: "Roles this company filled in this group (e.g. Label, Publisher)",
	}),
	...(
		[
			{ group: "book-group", media: "book", name: "Book Series to Book" },
			{ group: "music-group", media: "music", name: "Music Album to Music" },
			{ group: "movie-group", media: "movie", name: "Movie Collection to Movie" },
			{ group: "audiobook-group", media: "audiobook", name: "Audiobook Series to Audiobook" },
			{ group: "comic-book-group", media: "comic-book", name: "Comic Book Series to Comic Book" },
			{
				media: "video-game",
				group: "video-game-group",
				name: "Video Game Collection to Video Game",
			},
		] as const
	).map(({ group, media, name }) => ({
		name,
		slug: `${group}-to-${media}`,
		sourceEntitySchemaSlug: group,
		targetEntitySchemaSlug: media,
		propertiesSchema: groupRolesPropertiesSchema,
	})),
];
