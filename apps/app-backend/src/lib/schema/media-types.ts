import { Schema } from "effect";

export const ImageSchema = Schema.Struct({
	type: Schema.Literal("s3", "remote"),
	key: Schema.optional(Schema.NullOr(Schema.String)),
	url: Schema.optional(Schema.NullOr(Schema.String)),
});

export type Image = typeof ImageSchema.Type;

export const UnlinkedCreatorSchema = Schema.Struct({
	name: Schema.String,
	role: Schema.String,
});

export type UnlinkedCreator = typeof UnlinkedCreatorSchema.Type;

const mediaBaseFields = {
	isNsfw: Schema.optional(Schema.NullOr(Schema.Boolean)),
	sourceUrl: Schema.optional(Schema.NullOr(Schema.String)),
	publishDate: Schema.optional(Schema.NullOr(Schema.String)),
	description: Schema.optional(Schema.NullOr(Schema.String)),
	providerRating: Schema.optional(Schema.NullOr(Schema.Number)),
	productionStatus: Schema.optional(Schema.NullOr(Schema.String)),
	genres: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
	publishYear: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
} as const;

const imagesField = {
	images: Schema.optional(Schema.NullOr(Schema.Array(ImageSchema))),
} as const;

const mediaWithCreatorsFields = {
	...mediaBaseFields,
	...imagesField,
	unlinkedCreators: Schema.optional(Schema.NullOr(Schema.Array(UnlinkedCreatorSchema))),
} as const;

const AiringScheduleItemSchema = Schema.Struct({
	airingAt: Schema.String,
	episode: Schema.Number.pipe(Schema.int()),
});

const PodcastEpisodeSchema = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	publishDate: Schema.String,
	number: Schema.Number.pipe(Schema.int()),
	overview: Schema.optional(Schema.NullOr(Schema.String)),
	thumbnail: Schema.optional(Schema.NullOr(Schema.String)),
	runtime: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

const TimeToBeatSchema = Schema.Struct({
	hastily: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
	normally: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
	completely: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

const PlatformReleaseSchema = Schema.Struct({
	name: Schema.String,
	releaseDate: Schema.optional(Schema.NullOr(Schema.String)),
	releaseRegion: Schema.optional(Schema.NullOr(Schema.String)),
});

export const MoviePropertiesSchema = Schema.Struct({
	...mediaBaseFields,
	...imagesField,
	runtime: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

export type MovieProperties = typeof MoviePropertiesSchema.Type;

export const ShowPropertiesSchema = Schema.Struct({
	...mediaBaseFields,
	...imagesField,
	totalSeasons: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
	totalEpisodes: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

export type ShowProperties = typeof ShowPropertiesSchema.Type;

export const AnimePropertiesSchema = Schema.Struct({
	...mediaBaseFields,
	...imagesField,
	episodes: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
	airingSchedule: Schema.optional(Schema.NullOr(Schema.Array(AiringScheduleItemSchema))),
});

export type AnimeProperties = typeof AnimePropertiesSchema.Type;

export const MangaPropertiesSchema = Schema.Struct({
	...mediaBaseFields,
	...imagesField,
	volumes: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
	chapters: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type MangaProperties = typeof MangaPropertiesSchema.Type;

export const ComicBookPropertiesSchema = Schema.Struct({
	...mediaBaseFields,
	...imagesField,
	pages: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

export type ComicBookProperties = typeof ComicBookPropertiesSchema.Type;

export const MusicPropertiesSchema = Schema.Struct({
	...mediaBaseFields,
	...imagesField,
	byVariousArtists: Schema.optional(Schema.NullOr(Schema.Boolean)),
	duration: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

export type MusicProperties = typeof MusicPropertiesSchema.Type;

export const VisualNovelPropertiesSchema = Schema.Struct({
	...mediaBaseFields,
	...imagesField,
	lengthMinutes: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

export type VisualNovelProperties = typeof VisualNovelPropertiesSchema.Type;

export const VideoGamePropertiesSchema = Schema.Struct({
	...mediaBaseFields,
	...imagesField,
	timeToBeat: Schema.optional(Schema.NullOr(TimeToBeatSchema)),
	platformReleases: Schema.optional(Schema.NullOr(Schema.Array(PlatformReleaseSchema))),
});

export type VideoGameProperties = typeof VideoGamePropertiesSchema.Type;

export const BookPropertiesSchema = Schema.Struct({
	...mediaWithCreatorsFields,
	isCompilation: Schema.optional(Schema.NullOr(Schema.Boolean)),
	pages: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

export type BookProperties = typeof BookPropertiesSchema.Type;

export const AudiobookPropertiesSchema = Schema.Struct({
	...mediaWithCreatorsFields,
	runtime: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

export type AudiobookProperties = typeof AudiobookPropertiesSchema.Type;

export const PodcastPropertiesSchema = Schema.Struct({
	...mediaWithCreatorsFields,
	episodes: Schema.optional(Schema.NullOr(Schema.Array(PodcastEpisodeSchema))),
	totalEpisodes: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
});

export type PodcastProperties = typeof PodcastPropertiesSchema.Type;
