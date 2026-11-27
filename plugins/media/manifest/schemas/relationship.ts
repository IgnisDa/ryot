import type { PluginRelationshipSchema } from "@ryot-app/contract/modules/plugins/manifest";
import type {
	AuthoredAppSchema,
	ManifestText,
} from "@ryot-app/contract/modules/plugins/manifest-text";

import { creditRoleCodes } from "../../shared/credit-roles";
import { librarySummaryPropertiesSchema } from "../../shared/library-summary";
import { mediaCopyPropertiesSchema, mediaCopyRelationship } from "../../shared/media-copy";
import {
	builtinMediaEntitySchemaSlugs,
	type MediaCreatorCreditSlug,
	mediaGroupMemberSlugs,
} from "../../shared/media-schema-slugs";
import { catalogMessage } from "../../shared/messages.generated";
import { slugify } from "../../shared/slug";

const creditRelationshipName: Record<"show-episode" | MediaCreatorCreditSlug, ManifestText> = {
	book: catalogMessage("relationship-schema.book-credits.name"),
	show: catalogMessage("relationship-schema.show-credits.name"),
	anime: catalogMessage("relationship-schema.anime-credits.name"),
	movie: catalogMessage("relationship-schema.movie-credits.name"),
	manga: catalogMessage("relationship-schema.manga-credits.name"),
	music: catalogMessage("relationship-schema.music-credits.name"),
	podcast: catalogMessage("relationship-schema.podcast-credits.name"),
	audiobook: catalogMessage("relationship-schema.audiobook-credits.name"),
	"comic-book": catalogMessage("relationship-schema.comic-book-credits.name"),
	"video-game": catalogMessage("relationship-schema.video-game-credits.name"),
	"music-group": catalogMessage("relationship-schema.music-group-credits.name"),
	"visual-novel": catalogMessage("relationship-schema.visual-novel-credits.name"),
	"show-episode": catalogMessage("relationship-schema.show-episode-credits.name"),
	"video-game-group": catalogMessage("relationship-schema.video-game-group-credits.name"),
};

const roleCodesField = {
	type: "enum-array" as const,
	label: catalogMessage("property.role-codes"),
	description: "Standard roles derived by the provider rather than named by it",
	choices: { kind: "static" as const, values: creditRoleCodes.map((value) => ({ value })) },
};

type BuiltinRelationshipSchema = {
	slug: string;
	name: ManifestText;
	propertiesSchema: AuthoredAppSchema;
	sourceEntitySchemaSlug: null | string;
	targetEntitySchemaSlug: null | string;
	keyed?: PluginRelationshipSchema["keyed"];
	retention?: PluginRelationshipSchema["retention"];
	projection?: PluginRelationshipSchema["projection"];
	userWritePolicy?: PluginRelationshipSchema["userWritePolicy"];
};

const groupRolesPropertiesSchema = {
	fields: {
		order: {
			type: "number" as const,
			label: catalogMessage("property.order"),
			description: "Position of this media item within the group (1-based)",
		},
		roles: {
			type: "array" as const,
			label: catalogMessage("property.roles"),
			description: "Roles this group filled in this media",
			items: {
				type: "string" as const,
				description: "A specific role name",
				label: catalogMessage("property.role"),
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
	targetEntitySchemaSlugs?: ReadonlyArray<keyof typeof creditRelationshipName>;
}) =>
	(input.targetEntitySchemaSlugs ?? builtinMediaEntitySchemaSlugs).map((mediaSlug) => ({
		targetEntitySchemaSlug: mediaSlug,
		name: creditRelationshipName[mediaSlug],
		sourceEntitySchemaSlug: input.sourceSlug,
		slug: slugify(`${input.sourceSlug} to ${mediaSlug}`),
		propertiesSchema: {
			fields: {
				...(input.characterDescription !== undefined
					? {
							character: {
								type: "string" as const,
								description: input.characterDescription,
								label: catalogMessage("property.character"),
							},
							isGuest: {
								type: "boolean" as const,
								label: catalogMessage("property.guest-appearance"),
								description: "Whether all known cast appearances are guest appearances",
							},
							isUncredited: {
								type: "boolean" as const,
								label: catalogMessage("property.uncredited-appearance"),
								description: "Whether all known named cast appearances are uncredited",
							},
							creditKinds: {
								type: "array" as const,
								label: catalogMessage("property.credit-kinds"),
								description: "Kinds of credit held by this person in this production",
								items: {
									type: "string" as const,
									description: "Cast or crew",
									label: catalogMessage("property.kind"),
								},
							},
							departments: {
								type: "array" as const,
								label: catalogMessage("property.departments"),
								description: "Production departments associated with this person's credits",
								items: {
									type: "string" as const,
									description: "A production department name",
									label: catalogMessage("property.department"),
								},
							},
						}
					: {}),
				roleCodes: roleCodesField,
				order: {
					type: "number" as const,
					description: input.orderDescription,
					label: catalogMessage("property.order"),
				},
				roles: {
					type: "array" as const,
					description: input.rolesDescription,
					label: catalogMessage("property.roles"),
					items: {
						type: "string" as const,
						label: catalogMessage("property.role"),
						description: input.rolesItemDescription,
					},
				},
			},
		},
	}));

export const builtinRelationshipSchemas = (): BuiltinRelationshipSchema[] => [
	{
		slug: "in-media-library",
		sourceEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "media-library",
		projection: { propertiesSchema: librarySummaryPropertiesSchema },
		name: catalogMessage("relationship-schema.in-media-library.name"),
	},
	{
		keyed: true,
		slug: mediaCopyRelationship,
		targetEntitySchemaSlug: null,
		userWritePolicy: "source-owner",
		sourceEntitySchemaSlug: "media-library",
		name: catalogMessage("ownership.copies"),
		propertiesSchema: mediaCopyPropertiesSchema,
	},
	{
		slug: "media-monitoring",
		sourceEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "media-library",
		name: catalogMessage("relationship-schema.media-monitoring.name"),
	},
	{
		slug: "media-suggestion",
		sourceEntitySchemaSlug: null,
		targetEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		name: catalogMessage("relationship-schema.media-suggestion.name"),
	},
	{
		retention: "root",
		slug: "media-trending",
		sourceEntitySchemaSlug: null,
		targetEntitySchemaSlug: null,
		name: catalogMessage("relationship-schema.media-trending.name"),
		propertiesSchema: {
			fields: {
				rank: {
					type: "number" as const,
					label: catalogMessage("property.rank"),
					description: "Provider trend rank, ascending from the top item",
				},
				fetchedAt: {
					type: "datetime" as const,
					label: catalogMessage("property.fetched-at"),
					description: "When this trend entry was refreshed",
				},
			},
		},
	},
	{
		retention: "composition",
		slug: "show-to-show-season",
		sourceEntitySchemaSlug: "show",
		userWritePolicy: "source-owner",
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "show-season",
		name: catalogMessage("relationship-schema.show-to-show-season.name"),
	},
	{
		retention: "composition",
		userWritePolicy: "source-owner",
		propertiesSchema: { fields: {} },
		slug: "show-season-to-show-episode",
		sourceEntitySchemaSlug: "show-season",
		targetEntitySchemaSlug: "show-episode",
		name: catalogMessage("relationship-schema.show-season-to-show-episode.name"),
	},
	{
		retention: "composition",
		userWritePolicy: "source-owner",
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: "podcast",
		slug: "podcast-to-podcast-episode",
		targetEntitySchemaSlug: "podcast-episode",
		name: catalogMessage("relationship-schema.podcast-to-podcast-episode.name"),
	},
	...builtinMediaEntitySchemaSlugs.map((sourceEntitySchemaSlug) => ({
		sourceEntitySchemaSlug,
		targetEntitySchemaSlug: "genre",
		propertiesSchema: { fields: {} },
		userWritePolicy: "source-owner" as const,
		slug: `${sourceEntitySchemaSlug}-to-genre`,
		name: catalogMessage("relationship-schema.genres.name"),
	})),
	...buildCreditRelationshipSchemas({
		sourceSlug: "person",
		rolesItemDescription: "A specific role name (e.g. Director, Writer)",
		characterDescription: "Character played by this person in this production",
		orderDescription: "Display order of this person in the production credits",
		targetEntitySchemaSlugs: [...builtinMediaEntitySchemaSlugs, "show-episode"],
		rolesDescription:
			"Roles this person filled in this production, as the provider names them (e.g. Director, Writer)",
	}),
	...buildCreditRelationshipSchemas({
		sourceSlug: "company",
		targetEntitySchemaSlugs: builtinMediaEntitySchemaSlugs,
		rolesItemDescription: "A specific role name (e.g. Animation)",
		orderDescription: "Display order of this company in the production credits",
		rolesDescription:
			"Roles this company filled in this production, as the provider names them (e.g. Animation)",
	}),
	{
		slug: "person-to-music-group",
		sourceEntitySchemaSlug: "person",
		targetEntitySchemaSlug: "music-group",
		name: creditRelationshipName["music-group"],
		propertiesSchema: {
			fields: {
				roleCodes: roleCodesField,
				order: {
					type: "number" as const,
					label: catalogMessage("property.order"),
					description: "Display order of this person in the group credits",
				},
				roles: {
					type: "array" as const,
					label: catalogMessage("property.roles"),
					description:
						"Roles this person filled in this group, as the provider names them (e.g. Artist)",
					items: {
						type: "string" as const,
						label: catalogMessage("property.role"),
						description: "A specific role name (e.g. Artist)",
					},
				},
			},
		},
	},
	{
		sourceEntitySchemaSlug: "person",
		slug: "person-to-video-game-group",
		targetEntitySchemaSlug: "video-game-group",
		name: creditRelationshipName["video-game-group"],
		propertiesSchema: {
			fields: {
				roleCodes: roleCodesField,
				order: {
					type: "number" as const,
					label: catalogMessage("property.order"),
					description: "Display order of this person in the group credits",
				},
				roles: {
					type: "array" as const,
					label: catalogMessage("property.roles"),
					description:
						"Roles this person filled in this group, as the provider names them (e.g. Developer)",
					items: {
						type: "string" as const,
						label: catalogMessage("property.role"),
						description: "A specific role name (e.g. Developer)",
					},
				},
			},
		},
	},
	...buildCreditRelationshipSchemas({
		sourceSlug: "company",
		rolesItemDescription: "A specific role name (e.g. Label)",
		targetEntitySchemaSlugs: ["music-group", "video-game-group"],
		orderDescription: "Display order of this company in the group credits",
		rolesDescription:
			"Roles this company filled in this group, as the provider names them (e.g. Label)",
	}),
	{
		slug: "video-game-to-video-game",
		sourceEntitySchemaSlug: "video-game",
		targetEntitySchemaSlug: "video-game",
		name: catalogMessage("relationship-schema.video-game-to-video-game.name"),
		propertiesSchema: {
			fields: {
				kind: {
					type: "string" as const,
					label: catalogMessage("property.kind"),
					description: "How the target relates to the source, e.g. Port, Remake, Edition",
				},
			},
		},
	},
	...(
		[
			{ group: "book-group", name: catalogMessage("relationship-schema.book-group-to-book.name") },
			{
				group: "music-group",
				name: catalogMessage("relationship-schema.music-group-to-music.name"),
			},
			{
				group: "movie-group",
				name: catalogMessage("relationship-schema.movie-group-to-movie.name"),
			},
			{
				group: "audiobook-group",
				name: catalogMessage("relationship-schema.audiobook-group-to-audiobook.name"),
			},
			{
				group: "comic-book-group",
				name: catalogMessage("relationship-schema.comic-book-group-to-comic-book.name"),
			},
			{
				group: "video-game-group",
				name: catalogMessage("relationship-schema.video-game-group-to-video-game.name"),
			},
		] as const
	).map(({ name, group }) => ({
		name,
		sourceEntitySchemaSlug: group,
		propertiesSchema: groupRolesPropertiesSchema,
		slug: `${group}-to-${mediaGroupMemberSlugs[group]}`,
		targetEntitySchemaSlug: mediaGroupMemberSlugs[group],
	})),
];
