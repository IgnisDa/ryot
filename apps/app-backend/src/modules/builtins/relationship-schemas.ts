import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { normalizeSlug } from "@ryot/ts-utils/slug";

import {
	builtinMediaEntitySchemaSlugs,
	builtinNonGroupMediaEntitySchemaSlugs,
} from "~/lib/media/constants";

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
	targetEntitySchemaSlugs?: string[];
}) =>
	(input.targetEntitySchemaSlugs ?? builtinMediaEntitySchemaSlugs).map((mediaSlug) => ({
		sourceEntitySchemaSlug: input.sourceSlug,
		targetEntitySchemaSlug: mediaSlug,
		slug: normalizeSlug(`${input.sourceSlug} to ${mediaSlug}`),
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
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "library",
	},
	{
		slug: "member-of",
		name: "Member Of",
		sourceEntitySchemaSlug: null,
		targetEntitySchemaSlug: "collection",
		propertiesSchema: {
			unknownKeys: "passthrough" as const,
			fields: {
				rank: {
					label: "Rank",
					defaultValue: 0,
					type: "number" as const,
					description: "Sort order of this entity within the collection",
				},
			},
		},
	},
	{
		slug: "workout-repeated-from",
		name: "Workout Repeated From",
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: "workout",
		targetEntitySchemaSlug: "workout",
	},
	{
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: "workout",
		slug: "workout-to-workout-template",
		name: "Workout to Workout Template",
		targetEntitySchemaSlug: "workout-template",
	},
	...buildCreditRelationshipSchemas({
		sourceSlug: "person",
		targetEntitySchemaSlugs: builtinNonGroupMediaEntitySchemaSlugs,
		characterDescription: "Character played by this person in this production",
		orderDescription: "Display order of this person in the production credits",
		rolesItemDescription: "A specific role name (e.g. Director, Actor, Writer)",
		rolesDescription: "Roles this person filled in this production (e.g. Director, Actor, Writer)",
	}),
	...buildCreditRelationshipSchemas({
		sourceSlug: "company",
		targetEntitySchemaSlugs: builtinNonGroupMediaEntitySchemaSlugs,
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
