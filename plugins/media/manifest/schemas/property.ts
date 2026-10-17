import {
	integerField,
	managedAssetItemSchema,
	numberField,
	stringArrayField,
	stringField,
	translatableStringField,
} from "@ryot-app/contract/schema/core";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";

import { mediaImagePurposes } from "../../shared/media-image";
import { showEpisodeOrderTypes } from "../../shared/show-episode-order";
import { watchProviderOffers } from "../../shared/watch-provider";

const booleanField = (label: string, description: string) =>
	({ label, description, type: "boolean" }) as const;

const required = <Field extends AppPropertyDefinition>(field: Field) => ({
	...field,
	validation: { required: true as const },
});

const objectItems = <Properties extends Record<string, AppPropertyDefinition>>(
	properties: Properties,
) =>
	({
		properties,
		label: "Item",
		type: "object",
		description: "Item",
		unknownKeys: "strict",
	}) as const;

const mediaImagesField = (description: string) =>
	({
		description,
		type: "array",
		label: "Images",
		translatable: true,
		items: {
			...managedAssetItemSchema,
			properties: {
				...managedAssetItemSchema.properties,
				purpose: required({
					type: "enum",
					label: "Purpose",
					description: "Purpose",
					choices: { kind: "static", values: mediaImagePurposes.map((value) => ({ value })) },
				}),
			},
		},
	}) satisfies AppPropertyDefinition;

const watchProvidersField = (description: string) =>
	({
		description,
		type: "array",
		label: "Watch Providers",
		items: objectItems({
			link: stringField("Link", "Where to see every offer here"),
			country: required(stringField("Country", "ISO 3166-1 alpha-2 country code")),
			providers: {
				type: "array",
				label: "Providers",
				description: "Services carrying the title in this country",
				items: objectItems({
					name: required(stringField("Name", "Name")),
					image: stringField("Image", "Provider logo image URL"),
					offers: {
						label: "Offers",
						type: "enum-array",
						validation: { minItems: 1 },
						description: "How the title is offered here",
						choices: { kind: "static", values: watchProviderOffers.map((value) => ({ value })) },
					},
				}),
			},
		}),
	}) satisfies AppPropertyDefinition;

const mediaBaseFields = {
	publishYear: integerField("Publish Year", "Year this media was first published or released"),
	sourceUrl: stringField("Source link", "Link to the original source or external provider page"),
	providerRating: numberField("Provider Rating", "Aggregate score from the external data provider"),
	isNsfw: booleanField(
		"Adult content",
		"Whether this media contains adult or not-safe-for-work content",
	),
	productionStatus: stringField(
		"Production Status",
		"Current production status (e.g. Ended, Continuing, Cancelled)",
	),
	publishDate: stringField(
		"Publish Date",
		"Exact date this media was first published or released, as an ISO 8601 date string (YYYY-MM-DD)",
	),
	description: translatableStringField(
		"Description",
		"Provider synopsis in restrictedMarkdown: basic formatting, :spoiler/:::spoiler, safe links, no raw HTML",
	),
};

const unlinkedCreatorItemSchema = objectItems({
	name: required(stringField("Name", "Name")),
	role: required(stringField("Role", "Role")),
});

const mediaWithCreatorsBaseFields = {
	...mediaBaseFields,
	unlinkedCreators: {
		type: "array",
		label: "Unlinked Creators",
		description: "Unlinked Creators",
		items: unlinkedCreatorItemSchema,
	} satisfies AppPropertyDefinition,
};

export const moviePropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		runtime: integerField("Runtime", "Runtime in minutes"),
		images: mediaImagesField("Cover and promotional images for this movie"),
		watchProviders: watchProvidersField("Where to watch this movie, by country"),
	},
};

export const showPropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this show"),
		watchProviders: watchProvidersField("Where to watch this show, by country"),
		totalSeasons: integerField("Total Seasons", "Total number of seasons in this show"),
		totalEpisodes: integerField("Total Episodes", "Total number of episodes in this show"),
		episodeOrders: {
			type: "array",
			label: "Episode Orders",
			description: "Alternative episode orders, each listing episode external ids by group",
			items: objectItems({
				name: required(stringField("Name", "Name")),
				externalId: required(
					stringField("External Id", "Provider external id of this episode order"),
				),
				description: stringField(
					"Description",
					"Order summary in restrictedMarkdown: basic formatting, :spoiler/:::spoiler, safe links, no raw HTML",
				),
				type: required({
					type: "enum",
					label: "Type",
					description: "Kind of order the provider reports",
					choices: { kind: "static", values: showEpisodeOrderTypes.map((value) => ({ value })) },
				}),
				groups: required({
					type: "array",
					label: "Groups",
					description: "Groups of this order, sorted by position",
					items: objectItems({
						name: required(stringField("Name", "Name")),
						order: required(integerField("Order", "Position of this group within the order")),
						episodeExternalIds: required(
							stringArrayField(
								"Episode External Ids",
								"Provider external ids of this group's episodes, in order",
							),
						),
					}),
				}),
			}),
		},
	},
};

export const showSeasonPropertiesSchema: AppSchema = {
	fields: {
		images: mediaImagesField("Cover and promotional images for this season"),
		releaseDate: stringField("Release Date", "Season release date as an ISO 8601 date string"),
		parentShowExternalId: stringField(
			"Parent Show External Id",
			"Provider external id of the parent show",
		),
		description: translatableStringField(
			"Description",
			"Season summary in restrictedMarkdown: basic formatting, :spoiler/:::spoiler, safe links, no raw HTML",
		),
		seasonNumber: {
			type: "integer",
			label: "Season Number",
			validation: { minimum: 0, required: true },
			description: "Season number within the show, with 0 reserved for specials",
		},
	},
};

export const showEpisodePropertiesSchema: AppSchema = {
	fields: {
		runtime: integerField("Runtime", "Runtime in minutes"),
		images: mediaImagesField("Cover and promotional images for this episode"),
		publishDate: stringField("Publish Date", "Episode air date as an ISO 8601 date string"),
		parentShowExternalId: stringField(
			"Parent Show External Id",
			"Provider external id of the parent show",
		),
		description: translatableStringField(
			"Description",
			"Episode summary in restrictedMarkdown: basic formatting, :spoiler/:::spoiler, safe links, no raw HTML",
		),
		episodeNumber: {
			type: "integer",
			label: "Episode Number",
			validation: { minimum: 0, required: true },
			description: "Episode number within the season",
		},
		seasonNumber: {
			type: "integer",
			label: "Season Number",
			validation: { minimum: 0, required: true },
			description: "Season number within the show, with 0 reserved for specials",
		},
	},
};

export const podcastEpisodePropertiesSchema: AppSchema = {
	fields: {
		runtime: integerField("Runtime", "Runtime in minutes"),
		images: mediaImagesField("Cover and promotional images for this episode"),
		publishDate: stringField("Publish Date", "Episode publish date as an ISO 8601 date string"),
		parentPodcastExternalId: stringField(
			"Parent Podcast External Id",
			"Provider external id of the parent podcast",
		),
		description: translatableStringField(
			"Description",
			"Episode summary in restrictedMarkdown: basic formatting, :spoiler/:::spoiler, safe links, no raw HTML",
		),
		episodeNumber: {
			type: "integer",
			label: "Episode Number",
			validation: { minimum: 0, required: true },
			description: "Episode number within the podcast",
		},
	},
};

export const animePropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this anime"),
		episodes: integerField("Episodes", "Total number of episodes, if known"),
		airingSchedule: {
			type: "array",
			label: "Airing Schedule",
			description: "Upcoming episode airing schedule",
			items: objectItems({
				episode: required(integerField("Episode", "Episode")),
				airingAt: required({ type: "datetime", label: "Airing At", description: "Airing At" }),
			}),
		},
	},
};

export const bookPropertiesSchema: AppSchema = {
	fields: {
		...mediaWithCreatorsBaseFields,
		images: mediaImagesField("Cover and related images for this book"),
		pages: integerField("Pages", "Total number of pages in this edition"),
		isCompilation: {
			type: "boolean",
			label: "Is Compilation",
			description: "Whether this is an anthology or compilation of multiple works",
		},
	},
};

export const comicBookPropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this comic book"),
		pages: integerField("Pages", "Total number of pages in this issue or volume"),
	},
};

export const mangaPropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		volumes: integerField("Volumes", "Total number of volumes, if known"),
		images: mediaImagesField("Cover and promotional images for this manga"),
		chapters: numberField("Chapters", "Total number of chapters, if known"),
	},
};

export const visualNovelPropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this visual novel"),
		lengthMinutes: integerField(
			"Length Minutes",
			"Approximate time to complete this visual novel in minutes",
		),
	},
};

export const musicPropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		duration: integerField("Duration", "Total duration in seconds"),
		images: mediaImagesField("Cover art and promotional images for this music release"),
		byVariousArtists: {
			type: "boolean",
			label: "By Various Artists",
			description: "Whether this release features multiple artists rather than a single act",
		},
	},
};

export const audiobookPropertiesSchema: AppSchema = {
	fields: {
		...mediaWithCreatorsBaseFields,
		runtime: integerField("Runtime", "Total listening time in minutes"),
		images: mediaImagesField("Cover and promotional images for this audiobook"),
	},
};

export const podcastPropertiesSchema: AppSchema = {
	fields: {
		...mediaWithCreatorsBaseFields,
		images: mediaImagesField("Cover and promotional images for this podcast"),
		totalEpisodes: integerField(
			"Total Episodes",
			"Total number of episodes published by this podcast",
		),
	},
};

export const videoGamePropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: mediaImagesField("Cover and promotional images for this video game"),
		gameType: stringField(
			"Game Type",
			"Provider classification of this release, e.g. Main Game, Port, Remake",
		),
		platformReleases: {
			type: "array",
			label: "Platform Releases",
			description: "Platform-specific release information",
			items: objectItems({
				name: required(stringField("Name", "Name")),
				releaseDate: stringField("Release Date", "Release Date"),
				releaseRegion: stringField("Release Region", "Release Region"),
			}),
		},
		timeToBeat: {
			type: "object",
			label: "Time To Beat",
			unknownKeys: "strict",
			description: "Estimated time to complete the game at different paces",
			properties: {
				hastily: {
					type: "integer",
					label: "Rushed (minutes)",
					description: "Minutes to finish when rushing through",
				},
				completely: {
					type: "integer",
					label: "Completionist (minutes)",
					description: "Minutes to finish everything",
				},
				normally: {
					type: "integer",
					label: "Main story (minutes)",
					description: "Minutes to finish at a typical pace",
				},
			},
		},
	},
};

export const personPropertiesSchema: AppSchema = {
	fields: {
		birthDate: stringField("Birth Date", "Date of birth"),
		gender: stringField("Gender", "Reported gender of this person"),
		images: mediaImagesField("Photos or profile images of this person"),
		deathDate: stringField("Death Date", "Date of death, if applicable"),
		birthPlace: stringField("Birth Place", "City or country where this person was born"),
		website: stringField("Website", "Official website or online presence of this person"),
		sourceUrl: stringField(
			"Source link",
			"Link to the external source or provider page for this person",
		),
		alternateNames: stringArrayField(
			"Alternate Names",
			"Other names or aliases this person is known by",
		),
		description: translatableStringField(
			"Description",
			"Provider biography in restrictedMarkdown: basic formatting, :spoiler/:::spoiler, safe links, no raw HTML",
		),
	},
};

export const companyPropertiesSchema: AppSchema = {
	fields: {
		website: stringField("Website", "Official website of this company"),
		images: mediaImagesField("Logos or images associated with this company"),
		foundedYear: integerField("Founded Year", "Year this company was founded"),
		headquarters: stringField(
			"Headquarters",
			"City or country where this company is headquartered",
		),
		sourceUrl: stringField(
			"Source link",
			"Link to the external source or provider page for this company",
		),
		alternateNames: stringArrayField(
			"Alternate Names",
			"Other names or aliases this company is known by",
		),
		description: translatableStringField(
			"Description",
			"Provider overview in restrictedMarkdown: basic formatting, :spoiler/:::spoiler, safe links, no raw HTML",
		),
	},
};

export const mediaGroupPropertiesSchema: AppSchema = {
	fields: {
		parts: integerField("Parts", "Number of items in this group"),
		images: mediaImagesField("Cover and promotional images for this group"),
		sourceUrl: stringField("Source link", "Link to the original source or external provider page"),
		description: translatableStringField(
			"Description",
			"Provider group overview in restrictedMarkdown: basic formatting, :spoiler/:::spoiler, safe links, no raw HTML",
		),
	},
};
