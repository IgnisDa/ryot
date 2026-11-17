import type {
	AuthoredAppSchema,
	AuthoredSchemaText,
	ManifestText,
} from "@ryot-app/contract/modules/plugins/manifest-text";
import {
	integerField,
	managedAssetItemSchema,
	numberField,
	stringArrayField,
	stringField,
	translatableStringField,
} from "@ryot-app/contract/schema/core";
import type { AppPropertyDefinition } from "@ryot-app/contract/schema/property-schema";

import { creditRoleCodes } from "../../shared/credit-roles";
import { mediaImagePurposes } from "../../shared/media-image";
import { catalogMessage } from "../../shared/messages.generated";
import { originalLanguageFields } from "../../shared/original-language";
import { showEpisodeOrderTypes } from "../../shared/show-episode-order";
import { watchProviderOffers } from "../../shared/watch-provider";

const booleanField = (label: ManifestText, description: string) =>
	({ label, description, type: "boolean" }) as const;

const required = <Field extends AppPropertyDefinition<AuthoredSchemaText>>(field: Field) => ({
	...field,
	validation: { required: true as const },
});

const objectItems = <Properties extends Record<string, AppPropertyDefinition<AuthoredSchemaText>>>(
	properties: Properties,
) =>
	({
		properties,
		type: "object",
		description: "Item",
		unknownKeys: "strict",
		label: catalogMessage("property.item"),
	}) as const;

const mediaImagesField = (description: string) =>
	({
		description,
		type: "array",
		translatable: true,
		label: catalogMessage("property.images"),
		items: {
			...managedAssetItemSchema,
			properties: {
				...managedAssetItemSchema.properties,
				purpose: required({
					type: "enum",
					description: "Purpose",
					label: catalogMessage("property.purpose"),
					choices: { kind: "static", values: mediaImagePurposes.map((value) => ({ value })) },
				}),
			},
		},
	}) satisfies AppPropertyDefinition<AuthoredSchemaText>;

const watchProvidersField = (description: string) =>
	({
		description,
		type: "array",
		label: catalogMessage("property.watch-providers"),
		items: objectItems({
			link: stringField(catalogMessage("property.link"), "Where to see every offer here"),
			country: required(
				stringField(catalogMessage("property.country"), "ISO 3166-1 alpha-2 country code"),
			),
			providers: {
				type: "array",
				label: catalogMessage("property.providers"),
				description: "Services carrying the title in this country",
				items: objectItems({
					name: required(stringField(catalogMessage("property.name"), "Name")),
					image: stringField(catalogMessage("property.image"), "Provider logo image URL"),
					offers: {
						type: "enum-array",
						validation: { minItems: 1 },
						label: catalogMessage("property.offers"),
						description: "How the title is offered here",
						choices: { kind: "static", values: watchProviderOffers.map((value) => ({ value })) },
					},
				}),
			},
		}),
	}) satisfies AppPropertyDefinition<AuthoredSchemaText>;

const mediaBaseFields = {
	publishYear: integerField(
		catalogMessage("property.publish-year"),
		"Year this media was first published or released",
	),
	sourceUrl: stringField(
		catalogMessage("property.source-link"),
		"Link to the original source or external provider page",
	),
	isNsfw: booleanField(
		catalogMessage("property.adult-content"),
		"Whether this media contains adult or not-safe-for-work content",
	),
	publishDate: stringField(
		catalogMessage("property.publish-date"),
		"Date this media was first published or released, as YYYY-MM-DD",
	),
	description: translatableStringField(
		catalogMessage("property.description"),
		"Synopsis. Supports basic Markdown formatting and spoilers",
	),
	productionStatus: stringField(
		catalogMessage("property.production-status"),
		"Current production status (e.g. Ended, Continuing, Cancelled)",
	),
	providerRating: numberField(
		catalogMessage("property.provider-rating"),
		"Aggregate score from the external data provider, normalized to a 0-100 scale",
	),
};

const unlinkedCreatorItemSchema = objectItems({
	name: required(stringField(catalogMessage("property.name"), "Name")),
	role: stringField(catalogMessage("property.role"), "Role as the source names it"),
	roleCode: {
		type: "enum",
		label: catalogMessage("property.role-code"),
		description: "Standard role derived by the provider rather than named by it",
		choices: { kind: "static", values: creditRoleCodes.map((value) => ({ value })) },
	},
});

const mediaWithCreatorsBaseFields = {
	...mediaBaseFields,
	unlinkedCreators: {
		type: "array",
		description: "Unlinked Creators",
		items: unlinkedCreatorItemSchema,
		label: catalogMessage("property.unlinked-creators"),
	} satisfies AppPropertyDefinition<AuthoredSchemaText>,
};

export const moviePropertiesSchema: AuthoredAppSchema = {
	fields: {
		...originalLanguageFields,
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this movie"),
		watchProviders: watchProvidersField("Where to watch this movie, by country"),
		runtime: integerField(catalogMessage("property.runtime"), "Runtime in minutes"),
	},
};

export const showPropertiesSchema: AuthoredAppSchema = {
	fields: {
		...originalLanguageFields,
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this show"),
		watchProviders: watchProvidersField("Where to watch this show, by country"),
		totalSeasons: integerField(
			catalogMessage("property.total-seasons"),
			"Total number of seasons in this show",
		),
		totalEpisodes: integerField(
			catalogMessage("property.total-episodes"),
			"Total number of episodes in this show",
		),
		episodeOrders: {
			type: "array",
			label: catalogMessage("property.episode-orders"),
			description: "Alternative episode orders, each listing episode external ids by group",
			items: objectItems({
				name: required(stringField(catalogMessage("property.name"), "Name")),
				description: stringField(
					catalogMessage("property.description"),
					"Order summary. Supports basic Markdown formatting and spoilers",
				),
				externalId: required(
					stringField(
						catalogMessage("property.external-id"),
						"Provider external id of this episode order",
					),
				),
				type: required({
					type: "enum",
					label: catalogMessage("property.type"),
					description: "Kind of order the provider reports",
					choices: { kind: "static", values: showEpisodeOrderTypes.map((value) => ({ value })) },
				}),
				groups: required({
					type: "array",
					label: catalogMessage("property.groups"),
					description: "Groups of this order, sorted by position",
					items: objectItems({
						name: required(stringField(catalogMessage("property.name"), "Name")),
						order: required(
							integerField(
								catalogMessage("property.order"),
								"Position of this group within the order",
							),
						),
						episodeExternalIds: required(
							stringArrayField(
								catalogMessage("property.episode-external-ids"),
								"Provider external ids of this group's episodes, in order",
							),
						),
					}),
				}),
			}),
		},
	},
};

export const showSeasonPropertiesSchema: AuthoredAppSchema = {
	fields: {
		images: mediaImagesField("Cover and promotional images for this season"),
		releaseDate: stringField(
			catalogMessage("property.release-date"),
			"Season release date, as YYYY-MM-DD",
		),
		parentShowExternalId: stringField(
			catalogMessage("property.parent-show-external-id"),
			"Provider external id of the parent show",
		),
		description: translatableStringField(
			catalogMessage("property.description"),
			"Season summary. Supports basic Markdown formatting and spoilers",
		),
		seasonNumber: {
			immutable: true,
			type: "integer",
			validation: { minimum: 0, required: true },
			label: catalogMessage("property.season-number"),
			description: "Season number within the show, with 0 reserved for specials",
		},
	},
};

export const showEpisodePropertiesSchema: AuthoredAppSchema = {
	fields: {
		images: mediaImagesField("Cover and promotional images for this episode"),
		runtime: integerField(catalogMessage("property.runtime"), "Runtime in minutes"),
		publishDate: stringField(
			catalogMessage("property.publish-date"),
			"Episode air date, as YYYY-MM-DD",
		),
		parentShowExternalId: stringField(
			catalogMessage("property.parent-show-external-id"),
			"Provider external id of the parent show",
		),
		description: translatableStringField(
			catalogMessage("property.description"),
			"Episode summary. Supports basic Markdown formatting and spoilers",
		),
		episodeNumber: {
			type: "integer",
			validation: { minimum: 0, required: true },
			description: "Episode number within the season",
			label: catalogMessage("property.episode-number"),
		},
		seasonNumber: {
			immutable: true,
			type: "integer",
			validation: { minimum: 0, required: true },
			label: catalogMessage("property.season-number"),
			description: "Season number within the show, with 0 reserved for specials",
		},
	},
};

export const podcastEpisodePropertiesSchema: AuthoredAppSchema = {
	fields: {
		images: mediaImagesField("Cover and promotional images for this episode"),
		runtime: integerField(catalogMessage("property.runtime"), "Runtime in minutes"),
		publishDate: stringField(
			catalogMessage("property.publish-date"),
			"Episode publish date, as YYYY-MM-DD",
		),
		parentPodcastExternalId: stringField(
			catalogMessage("property.parent-podcast-external-id"),
			"Provider external id of the parent podcast",
		),
		description: translatableStringField(
			catalogMessage("property.description"),
			"Episode summary. Supports basic Markdown formatting and spoilers",
		),
		episodeNumber: {
			type: "integer",
			validation: { minimum: 0, required: true },
			label: catalogMessage("property.episode-number"),
			description: "Episode number within the podcast",
		},
	},
};

export const animePropertiesSchema: AuthoredAppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this anime"),
		episodes: integerField(
			catalogMessage("property.episodes"),
			"Total number of episodes, if known",
		),
		airingSchedule: {
			type: "array",
			description: "Upcoming episode airing schedule",
			label: catalogMessage("property.airing-schedule"),
			items: objectItems({
				episode: required(integerField(catalogMessage("property.episode"), "Episode")),
				airingAt: required({
					type: "datetime",
					description: "Airing At",
					label: catalogMessage("property.airing-at"),
				}),
			}),
		},
	},
};

export const bookPropertiesSchema: AuthoredAppSchema = {
	fields: {
		...mediaWithCreatorsBaseFields,
		images: mediaImagesField("Cover and related images for this book"),
		pages: integerField(catalogMessage("property.pages"), "Total number of pages in this edition"),
		isCompilation: {
			type: "boolean",
			label: catalogMessage("property.compilation"),
			description: "Whether this is an anthology or compilation of multiple works",
		},
	},
};

export const comicBookPropertiesSchema: AuthoredAppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this comic book"),
		pages: integerField(
			catalogMessage("property.pages"),
			"Total number of pages in this issue or volume",
		),
	},
};

export const mangaPropertiesSchema: AuthoredAppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this manga"),
		volumes: integerField(catalogMessage("property.volumes"), "Total number of volumes, if known"),
		chapters: numberField(
			catalogMessage("property.chapters"),
			"Total number of chapters, if known",
		),
	},
};

export const visualNovelPropertiesSchema: AuthoredAppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this visual novel"),
		lengthMinutes: integerField(
			catalogMessage("property.length-minutes"),
			"Approximate time to complete this visual novel in minutes",
		),
	},
};

export const musicPropertiesSchema: AuthoredAppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover art and promotional images for this music release"),
		duration: integerField(catalogMessage("property.duration"), "Total duration in seconds"),
		byVariousArtists: {
			type: "boolean",
			label: catalogMessage("property.various-artists"),
			description: "Whether this release features multiple artists rather than a single act",
		},
	},
};

export const audiobookPropertiesSchema: AuthoredAppSchema = {
	fields: {
		...mediaWithCreatorsBaseFields,
		images: mediaImagesField("Cover and promotional images for this audiobook"),
		runtime: integerField(catalogMessage("property.runtime"), "Total listening time in minutes"),
	},
};

export const podcastPropertiesSchema: AuthoredAppSchema = {
	fields: {
		...mediaWithCreatorsBaseFields,
		images: mediaImagesField("Cover and promotional images for this podcast"),
		totalEpisodes: integerField(
			catalogMessage("property.total-episodes"),
			"Total number of episodes published by this podcast",
		),
	},
};

export const videoGamePropertiesSchema: AuthoredAppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this video game"),
		gameType: stringField(
			catalogMessage("property.game-type"),
			"Provider classification of this release, e.g. Main Game, Port, Remake",
		),
		platformReleases: {
			type: "array",
			label: catalogMessage("property.platform-releases"),
			description: "Platform-specific release information",
			items: objectItems({
				name: required(stringField(catalogMessage("property.name"), "Name")),
				releaseDate: stringField(catalogMessage("property.release-date"), "Release Date"),
				releaseRegion: stringField(catalogMessage("property.release-region"), "Release Region"),
			}),
		},
		timeToBeat: {
			type: "object",
			unknownKeys: "strict",
			label: catalogMessage("property.time-to-beat"),
			description: "Estimated time to complete the game at different paces",
			properties: {
				hastily: {
					type: "integer",
					label: catalogMessage("property.rushed-minutes"),
					description: "Minutes to finish when rushing through",
				},
				completely: {
					type: "integer",
					description: "Minutes to finish everything",
					label: catalogMessage("property.completionist-minutes"),
				},
				normally: {
					type: "integer",
					description: "Minutes to finish at a typical pace",
					label: catalogMessage("property.main-story-minutes"),
				},
			},
		},
	},
};

export const personPropertiesSchema: AuthoredAppSchema = {
	fields: {
		images: mediaImagesField("Photos or profile images of this person"),
		birthDate: stringField(catalogMessage("property.birth-date"), "Date of birth"),
		gender: stringField(catalogMessage("property.gender"), "Reported gender of this person"),
		deathDate: stringField(catalogMessage("property.death-date"), "Date of death, if applicable"),
		birthPlace: stringField(
			catalogMessage("property.birth-place"),
			"City or country where this person was born",
		),
		website: stringField(
			catalogMessage("property.website"),
			"Official website or online presence of this person",
		),
		sourceUrl: stringField(
			catalogMessage("property.source-link"),
			"Link to the external source or provider page for this person",
		),
		alternateNames: stringArrayField(
			catalogMessage("property.alternate-names"),
			"Other names or aliases this person is known by",
		),
		description: translatableStringField(
			catalogMessage("property.description"),
			"Biography. Supports basic Markdown formatting and spoilers",
		),
	},
};

export const companyPropertiesSchema: AuthoredAppSchema = {
	fields: {
		images: mediaImagesField("Logos or images associated with this company"),
		website: stringField(catalogMessage("property.website"), "Official website of this company"),
		foundedYear: integerField(
			catalogMessage("property.founded-year"),
			"Year this company was founded",
		),
		headquarters: stringField(
			catalogMessage("property.headquarters"),
			"City or country where this company is headquartered",
		),
		sourceUrl: stringField(
			catalogMessage("property.source-link"),
			"Link to the external source or provider page for this company",
		),
		alternateNames: stringArrayField(
			catalogMessage("property.alternate-names"),
			"Other names or aliases this company is known by",
		),
		description: translatableStringField(
			catalogMessage("property.description"),
			"Overview. Supports basic Markdown formatting and spoilers",
		),
	},
};

export const mediaGroupPropertiesSchema: AuthoredAppSchema = {
	fields: {
		images: mediaImagesField("Cover and promotional images for this group"),
		parts: integerField(catalogMessage("property.parts"), "Number of items in this group"),
		sourceUrl: stringField(
			catalogMessage("property.source-link"),
			"Link to the original source or external provider page",
		),
		description: translatableStringField(
			catalogMessage("property.description"),
			"Group overview. Supports basic Markdown formatting and spoilers",
		),
	},
};
