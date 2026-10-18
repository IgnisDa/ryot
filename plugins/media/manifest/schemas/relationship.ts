import type { PluginRelationshipSchema } from "@ryot-app/contract/modules/plugins/manifest";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import {
	builtinMediaEntitySchemaSlugs,
	mediaGroupMemberSlugs,
} from "../../shared/media-schema-slugs";
import { slugify } from "../../shared/slug";

const sentenceLabel = (slug: string) =>
	`${slug.charAt(0).toUpperCase()}${slug.slice(1).replaceAll("-", " ")}`;

type BuiltinRelationshipSchema = {
	slug: string;
	name: string;
	propertiesSchema: AppSchema;
	sourceEntitySchemaSlug: null | string;
	targetEntitySchemaSlug: null | string;
	retention?: PluginRelationshipSchema["retention"];
	userWritePolicy?: PluginRelationshipSchema["userWritePolicy"];
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
			items: { label: "Role", type: "string" as const, description: "A specific role name" },
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
		targetEntitySchemaSlug: mediaSlug,
		sourceEntitySchemaSlug: input.sourceSlug,
		name: `${sentenceLabel(mediaSlug)} credits`,
		slug: slugify(`${input.sourceSlug} to ${mediaSlug}`),
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
				order: { label: "Order", type: "number" as const, description: input.orderDescription },
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
		slug: "in-media-library",
		name: "In Media Library",
		sourceEntitySchemaSlug: null,
		targetEntitySchemaSlug: "media-library",
		propertiesSchema: {
			fields: {
				owned: {
					label: "Owned",
					type: "boolean" as const,
					description: "Whether the user owns this item",
				},
				ownedOn: {
					label: "Owned on",
					type: "date" as const,
					description: "When the user acquired this item",
				},
				ownershipSyncedAt: {
					type: "datetime" as const,
					label: "Ownership synced at",
					description: "When ownership was last synced from an external source",
				},
				ownershipSources: {
					type: "array" as const,
					label: "Ownership sources",
					description: "Integrations or sources that reported ownership",
					items: {
						label: "Source",
						type: "string" as const,
						description: "An integration or source that reported ownership",
					},
				},
			},
		},
	},
	{
		slug: "media-monitoring",
		name: "Media Monitoring",
		sourceEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "media-library",
	},
	{
		slug: "media-suggestion",
		name: "Media Suggestion",
		sourceEntitySchemaSlug: null,
		targetEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
	},
	{
		retention: "root",
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
					label: "Fetched at",
					type: "datetime" as const,
					description: "When this trend entry was refreshed",
				},
			},
		},
	},
	{
		retention: "composition",
		slug: "show-to-show-season",
		name: "Show to Show Season",
		sourceEntitySchemaSlug: "show",
		userWritePolicy: "source-owner",
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "show-season",
	},
	{
		retention: "composition",
		userWritePolicy: "source-owner",
		propertiesSchema: { fields: {} },
		slug: "show-season-to-show-episode",
		name: "Show Season to Show Episode",
		sourceEntitySchemaSlug: "show-season",
		targetEntitySchemaSlug: "show-episode",
	},
	{
		retention: "composition",
		userWritePolicy: "source-owner",
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: "podcast",
		slug: "podcast-to-podcast-episode",
		name: "Podcast to Podcast Episode",
		targetEntitySchemaSlug: "podcast-episode",
	},
	...builtinMediaEntitySchemaSlugs.map((sourceEntitySchemaSlug) => ({
		name: "Genres",
		sourceEntitySchemaSlug,
		targetEntitySchemaSlug: "genre",
		propertiesSchema: { fields: {} },
		userWritePolicy: "source-owner" as const,
		slug: `${sourceEntitySchemaSlug}-to-genre`,
	})),
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
		name: "Music group credits",
		slug: "person-to-music-group",
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
		name: "Video game group credits",
		slug: "person-to-video-game-group",
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
		rolesItemDescription: "A specific role name (e.g. Label, Publisher)",
		orderDescription: "Display order of this company in the group credits",
		rolesDescription: "Roles this company filled in this group (e.g. Label, Publisher)",
	}),
	{
		name: "Related games",
		slug: "video-game-to-video-game",
		sourceEntitySchemaSlug: "video-game",
		targetEntitySchemaSlug: "video-game",
		propertiesSchema: {
			fields: {
				kind: {
					label: "Kind",
					type: "string" as const,
					description: "How the target relates to the source, e.g. Port, Remake, Edition",
				},
			},
		},
	},
	...(
		[
			{ name: "Books", group: "book-group" },
			{ name: "Music", group: "music-group" },
			{ name: "Movies", group: "movie-group" },
			{ name: "Audiobooks", group: "audiobook-group" },
			{ name: "Comic books", group: "comic-book-group" },
			{ name: "Video games", group: "video-game-group" },
		] as const
	).map(({ name, group }) => ({
		name,
		sourceEntitySchemaSlug: group,
		propertiesSchema: groupRolesPropertiesSchema,
		slug: `${group}-to-${mediaGroupMemberSlugs[group]}`,
		targetEntitySchemaSlug: mediaGroupMemberSlugs[group],
	})),
];
