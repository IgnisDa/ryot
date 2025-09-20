import {
	imagesField,
	integerField,
	mediaBaseFields,
	mediaWithCreatorsBaseFields,
	numberField,
	stringArrayField,
	stringField,
	type AppSchema,
} from "~/lib/schema";

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
		showSeasons: {
			type: "array",
			label: "Show Seasons",
			description: "Seasons in this show, each containing episodes",
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
					seasonNumber: {
						type: "integer",
						label: "Season Number",
						description: "Season Number",
						validation: { required: true },
					},
					id: {
						label: "Id",
						type: "integer",
						description: "Id",
						validation: { required: true },
					},
					posterImages: {
						type: "array",
						label: "Poster Images",
						description: "Poster Images",
						items: { type: "string", label: "Item", description: "Item" },
					},
					overview: { type: "string", label: "Overview", description: "Overview" },
					backdropImages: {
						type: "array",
						label: "Backdrop Images",
						description: "Backdrop Images",
						items: { type: "string", label: "Item", description: "Item" },
					},
					publishDate: {
						type: "string",
						label: "Publish Date",
						description: "Publish Date",
					},
					episodes: {
						type: "array",
						label: "Episodes",
						description: "Episodes",
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
								runtime: { type: "integer", label: "Runtime", description: "Runtime" },
								id: {
									label: "Id",
									type: "integer",
									description: "Id",
									validation: { required: true },
								},
								overview: { type: "string", label: "Overview", description: "Overview" },
								episodeNumber: {
									type: "integer",
									label: "Episode Number",
									description: "Episode Number",
									validation: { required: true },
								},
								posterImages: {
									type: "array",
									label: "Poster Images",
									description: "Poster Images",
									items: { type: "string", label: "Item", description: "Item" },
								},
								publishDate: {
									type: "string",
									label: "Publish Date",
									description: "Publish Date",
								},
							},
						},
					},
				},
			},
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
		episodes: {
			type: "array",
			label: "Episodes",
			description: "List of podcast episodes",
			items: {
				label: "Item",
				type: "object",
				description: "Item",
				unknownKeys: "strict",
				properties: {
					title: {
						type: "string",
						label: "Title",
						description: "Title",
						validation: { required: true },
					},
					id: {
						label: "Id",
						type: "string",
						description: "Id",
						validation: { required: true },
					},
					number: {
						type: "integer",
						label: "Number",
						description: "Number",
						validation: { required: true },
					},
					runtime: { type: "integer", label: "Runtime", description: "Runtime" },
					publishDate: {
						type: "string",
						label: "Publish Date",
						description: "Publish Date",
						validation: { required: true },
					},
					overview: { type: "string", label: "Overview", description: "Overview" },
					thumbnail: { type: "string", label: "Thumbnail", description: "Thumbnail" },
				},
			},
		},
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
		description: stringField("Description", "Biography or summary provided by the data provider"),
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
		description: stringField("Description", "Overview or biography provided by the data provider"),
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
		description: stringField(
			"Description",
			"Overview or description provided by the data provider",
		),
	},
};
