import {
	imagesField,
	integerField,
	mediaBaseFields,
	mediaWithCreatorsBaseFields,
	numberField,
	stringArrayField,
	stringField,
	translatableStringField,
} from "@ryot/contract/schema/core";
import type { AppSchema } from "@ryot/contract/schema/property-schema";

export const moviePropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		runtime: integerField("Runtime", "Runtime in minutes"),
		images: imagesField("Cover and promotional images for this movie"),
	},
};

export const showPropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: imagesField("Cover and promotional images for this show"),
		totalSeasons: integerField("Total Seasons", "Total number of seasons in this show"),
		totalEpisodes: integerField("Total Episodes", "Total number of episodes in this show"),
	},
};

export const showSeasonPropertiesSchema: AppSchema = {
	fields: {
		images: imagesField("Cover and promotional images for this season"),
		description: translatableStringField("Description", "Season overview or summary"),
		releaseDate: stringField("Release Date", "Season release date as an ISO 8601 date string"),
		parentShowExternalId: stringField(
			"Parent Show External Id",
			"Provider external id of the parent show",
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
		images: imagesField("Cover and promotional images for this episode"),
		description: translatableStringField("Description", "Episode overview or summary"),
		publishDate: stringField("Publish Date", "Episode air date as an ISO 8601 date string"),
		parentShowExternalId: stringField(
			"Parent Show External Id",
			"Provider external id of the parent show",
		),
		seasonNumber: {
			type: "integer",
			label: "Season Number",
			validation: { minimum: 0, required: true },
			description: "Season number within the show, with 0 reserved for specials",
		},
		episodeNumber: {
			type: "integer",
			label: "Episode Number",
			validation: { minimum: 0, required: true },
			description: "Episode number within the season",
		},
	},
};

export const podcastEpisodePropertiesSchema: AppSchema = {
	fields: {
		runtime: integerField("Runtime", "Runtime in minutes"),
		images: imagesField("Cover and promotional images for this episode"),
		description: translatableStringField("Description", "Episode overview or summary"),
		publishDate: stringField("Publish Date", "Episode publish date as an ISO 8601 date string"),
		parentPodcastExternalId: stringField(
			"Parent Podcast External Id",
			"Provider external id of the parent podcast",
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
		episodes: integerField("Episodes", "Total number of episodes, if known"),
		images: imagesField("Cover and promotional images for this anime"),
		airingSchedule: {
			type: "array",
			label: "Airing Schedule",
			description: "Upcoming episode airing schedule",
			items: {
				label: "Item",
				type: "object",
				description: "Item",
				unknownKeys: "strict",
				properties: {
					episode: {
						type: "integer",
						label: "Episode",
						description: "Episode",
						validation: { required: true },
					},
					airingAt: {
						type: "datetime",
						label: "Airing At",
						description: "Airing At",
						validation: { required: true },
					},
				},
			},
		},
	},
};

export const bookPropertiesSchema: AppSchema = {
	fields: {
		...mediaWithCreatorsBaseFields,
		images: imagesField("Cover and related images for this book"),
		pages: integerField("Pages", "Total number of pages in this edition"),
		isCompilation: {
			label: "Is Compilation",
			type: "boolean",
			description: "Whether this is an anthology or compilation of multiple works",
		},
	},
};

export const comicBookPropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: imagesField("Cover and promotional images for this comic book"),
		pages: integerField("Pages", "Total number of pages in this issue or volume"),
	},
};

export const mangaPropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: imagesField("Cover and promotional images for this manga"),
		volumes: integerField("Volumes", "Total number of volumes, if known"),
		chapters: numberField("Chapters", "Total number of chapters, if known"),
	},
};

export const visualNovelPropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: imagesField("Cover and promotional images for this visual novel"),
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
		images: imagesField("Cover art and promotional images for this music release"),
		byVariousArtists: {
			label: "By Various Artists",
			type: "boolean",
			description: "Whether this release features multiple artists rather than a single act",
		},
	},
};

export const audiobookPropertiesSchema: AppSchema = {
	fields: {
		...mediaWithCreatorsBaseFields,
		runtime: integerField("Runtime", "Total listening time in minutes"),
		images: imagesField("Cover and promotional images for this audiobook"),
	},
};

export const podcastPropertiesSchema: AppSchema = {
	fields: {
		...mediaWithCreatorsBaseFields,
		images: imagesField("Cover and promotional images for this podcast"),
		totalEpisodes: integerField(
			"Total Episodes",
			"Total number of episodes published by this podcast",
		),
	},
};

export const videoGamePropertiesSchema: AppSchema = {
	fields: {
		...mediaBaseFields,
		images: imagesField("Cover and promotional images for this video game"),
		timeToBeat: {
			type: "object",
			label: "Time To Beat",
			unknownKeys: "strict",
			description: "Estimated time to complete the game at different paces",
			properties: {
				normally: {
					type: "integer",
					label: "Normally",
					description: "Normally",
				},
				hastily: {
					type: "integer",
					label: "Hastily",
					description: "Hastily",
				},
				completely: {
					type: "integer",
					label: "Completely",
					description: "Completely",
				},
			},
		},
		platformReleases: {
			type: "array",
			label: "Platform Releases",
			description: "Platform-specific release information",
			items: {
				label: "Item",
				type: "object",
				description: "Item",
				unknownKeys: "strict",
				properties: {
					name: {
						label: "Name",
						type: "string",
						description: "Name",
						validation: { required: true },
					},
					releaseDate: { type: "string", label: "Release Date", description: "Release Date" },
					releaseRegion: {
						type: "string",
						label: "Release Region",
						description: "Release Region",
					},
				},
			},
		},
	},
};

export const personPropertiesSchema: AppSchema = {
	fields: {
		birthDate: stringField("Birth Date", "Date of birth"),
		images: imagesField("Photos or profile images of this person"),
		gender: stringField("Gender", "Reported gender of this person"),
		deathDate: stringField("Death Date", "Date of death, if applicable"),
		birthPlace: stringField("Birth Place", "City or country where this person was born"),
		website: stringField("Website", "Official website or online presence of this person"),
		description: translatableStringField(
			"Description",
			"Biography or summary provided by the data provider",
		),
		alternateNames: stringArrayField(
			"Alternate Names",
			"Other names or aliases this person is known by",
		),
		sourceUrl: stringField(
			"Source Url",
			"Link to the external source or provider page for this person",
		),
	},
};

export const companyPropertiesSchema: AppSchema = {
	fields: {
		images: imagesField("Logos or images associated with this company"),
		website: stringField("Website", "Official website of this company"),
		foundedYear: integerField("Founded Year", "Year this company was founded"),
		description: translatableStringField(
			"Description",
			"Overview or biography provided by the data provider",
		),
		alternateNames: stringArrayField(
			"Alternate Names",
			"Other names or aliases this company is known by",
		),
		sourceUrl: stringField(
			"Source Url",
			"Link to the external source or provider page for this company",
		),
		headquarters: stringField(
			"Headquarters",
			"City or country where this company is headquartered",
		),
	},
};

export const mediaGroupPropertiesSchema: AppSchema = {
	fields: {
		images: imagesField("Cover and promotional images for this group"),
		parts: integerField("Parts", "Number of items in this group"),
		sourceUrl: stringField("Source Url", "Link to the original source or external provider page"),
		description: translatableStringField(
			"Description",
			"Overview or description provided by the data provider",
		),
	},
};
