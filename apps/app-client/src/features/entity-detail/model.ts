import type { paths } from "@ryot/generated/openapi/app-backend";
import { match } from "ts-pattern";

import { toEntityImage, type EntityImage } from "@/lib/entity-image";

import type {
	AudiobookDetail,
	BookDetail,
	ComicBookDetail,
	EntityDetail,
	MangaDetail,
	MovieDetail,
	MusicDetail,
	PodcastDetail,
	PodcastEpisode,
	ShowDetail,
	ShowEpisode,
	ShowSeason,
	UnlinkedCreator,
	VideoGameDetail,
	VisualNovelDetail,
} from "./types";

type EntityResponse =
	paths["/entities/{entityId}"]["get"]["responses"][200]["content"]["application/json"]["data"];

type RawRecord = Record<string, unknown>;
type EntitySchemaSlug = EntityDetail["entitySchemaSlug"];

type TimeToBeat = NonNullable<VideoGameDetail["timeToBeat"]>;
type PlatformRelease = NonNullable<VideoGameDetail["platformReleases"]>[number];

const SUPPORTED_ENTITY_SCHEMA_SLUGS = [
	"book",
	"movie",
	"show",
	"anime",
	"manga",
	"music",
	"podcast",
	"audiobook",
	"comic-book",
	"video-game",
	"visual-novel",
] as const satisfies readonly EntitySchemaSlug[];

export function isEntitySchemaSlug(value: string): value is EntitySchemaSlug {
	return SUPPORTED_ENTITY_SCHEMA_SLUGS.some((slug) => slug === value);
}

function isRecord(value: unknown): value is RawRecord {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
	return typeof value === "string" ? value : null;
}

function readNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown) {
	return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function readImages(value: unknown, fallback: unknown): EntityImage[] {
	const images = Array.isArray(value)
		? value.map(toEntityImage).filter((image): image is NonNullable<EntityImage> => image !== null)
		: [];
	if (images.length > 0) {
		return images;
	}

	const primaryImage = toEntityImage(fallback);
	return primaryImage ? [primaryImage] : [];
}

function readCreators(value: unknown): UnlinkedCreator[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!isRecord(item)) {
			return [];
		}

		const name = readString(item.name);
		const role = readString(item.role);
		if (!name || !role) {
			return [];
		}

		const creator: UnlinkedCreator = { name, role };
		if (typeof item.image === "string") {
			creator.image = item.image;
		}

		return [creator];
	});
}

function readShowSeasons(value: unknown): ShowSeason[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((seasonData) => {
		if (!isRecord(seasonData)) {
			return [];
		}

		const id = readNumber(seasonData.id);
		const name = readString(seasonData.name);
		const seasonNumber = readNumber(seasonData.seasonNumber);
		const episodes = Array.isArray(seasonData.episodes)
			? seasonData.episodes.flatMap((episodeData) => {
					if (!isRecord(episodeData)) {
						return [];
					}

					const episodeId = readNumber(episodeData.id);
					const episodeName = readString(episodeData.name);
					const episodeNumber = readNumber(episodeData.episodeNumber);
					if (episodeId === null || episodeName === null || episodeNumber === null) {
						return [];
					}

					const episodeDetail: ShowEpisode = {
						id: episodeId,
						episodeNumber,
						name: episodeName,
						runtime: readNumber(episodeData.runtime),
						overview: readString(episodeData.overview),
					};
					return [episodeDetail];
				})
			: [];

		if (id === null || name === null || seasonNumber === null) {
			return [];
		}

		const seasonDetail: ShowSeason = {
			id,
			name,
			episodes,
			seasonNumber,
			publishDate: readString(seasonData.publishDate),
		};
		return [seasonDetail];
	});
}

function readPodcastEpisodes(value: unknown): PodcastEpisode[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!isRecord(item)) {
			return [];
		}

		const id = readString(item.id);
		const title = readString(item.title);
		const number = readNumber(item.number);
		const publishDate = readString(item.publishDate);
		if (id === null || title === null || number === null || publishDate === null) {
			return [];
		}

		const episode: PodcastEpisode = {
			id,
			title,
			number,
			publishDate,
			runtime: readNumber(item.runtime),
			overview: readString(item.overview),
		};
		return [episode];
	});
}

function readTimeToBeat(value: unknown): TimeToBeat | null {
	if (!isRecord(value)) {
		return null;
	}

	const hastily = readNumber(value.hastily);
	const normally = readNumber(value.normally);
	const completely = readNumber(value.completely);
	if (hastily === null && normally === null && completely === null) {
		return null;
	}

	return { hastily, normally, completely };
}

function readPlatformReleases(value: unknown): PlatformRelease[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const releases = value.flatMap((item) => {
		if (!isRecord(item)) {
			return [];
		}

		const name = readString(item.name);
		if (!name) {
			return [];
		}

		return [
			{
				name,
				releaseDate: readString(item.releaseDate),
			} satisfies PlatformRelease,
		];
	});

	return releases;
}

function getCommonFields(entity: EntityResponse) {
	const properties = entity.properties;
	return {
		id: entity.id,
		name: entity.name,
		isNsfw: readBoolean(properties.isNsfw),
		genres: readStringArray(properties.genres),
		sourceUrl: readString(properties.sourceUrl),
		description: readString(properties.description),
		publishYear: readNumber(properties.publishYear),
		providerRating: readNumber(properties.providerRating),
		productionStatus: readString(properties.productionStatus),
		unlinkedCreators: readCreators(properties.unlinkedCreators),
		images: readImages(properties.images, entity.image),
	};
}

export function toEntityDetail(
	entity: EntityResponse,
	entitySchemaSlug: EntitySchemaSlug,
): EntityDetail | null {
	const base = getCommonFields(entity);
	const properties = entity.properties;

	return match(entitySchemaSlug)
		.with(
			"book",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					pages: readNumber(properties.pages),
					isCompilation: readBoolean(properties.isCompilation),
				}) satisfies BookDetail,
		)
		.with(
			"movie",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					runtime: readNumber(properties.runtime),
				}) satisfies MovieDetail,
		)
		.with(
			"show",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					showSeasons: readShowSeasons(properties.showSeasons),
				}) satisfies ShowDetail,
		)
		.with(
			"anime",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					episodes: readNumber(properties.episodes),
					airingSchedule: Array.isArray(properties.airingSchedule)
						? properties.airingSchedule.flatMap((item) => {
								if (!isRecord(item)) {
									return [];
								}

								const episode = readNumber(item.episode);
								const airingAt = readString(item.airingAt);
								if (episode === null || airingAt === null) {
									return [];
								}

								return [{ episode, airingAt }];
							})
						: null,
				}) satisfies EntityDetail,
		)
		.with(
			"manga",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					volumes: readNumber(properties.volumes),
					chapters: readNumber(properties.chapters),
				}) satisfies MangaDetail,
		)
		.with(
			"comic-book",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					pages: readNumber(properties.pages),
				}) satisfies ComicBookDetail,
		)
		.with(
			"audiobook",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					runtime: readNumber(properties.runtime),
				}) satisfies AudiobookDetail,
		)
		.with(
			"podcast",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					episodes: readPodcastEpisodes(properties.episodes),
					totalEpisodes: readNumber(properties.totalEpisodes),
				}) satisfies PodcastDetail,
		)
		.with(
			"music",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					duration: readNumber(properties.duration),
					byVariousArtists: readBoolean(properties.byVariousArtists),
				}) satisfies MusicDetail,
		)
		.with(
			"video-game",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					timeToBeat: readTimeToBeat(properties.timeToBeat),
					platformReleases: readPlatformReleases(properties.platformReleases),
				}) satisfies VideoGameDetail,
		)
		.with(
			"visual-novel",
			(v) =>
				({
					...base,
					entitySchemaSlug: v,
					lengthMinutes: readNumber(properties.lengthMinutes),
				}) satisfies VisualNovelDetail,
		)
		.otherwise(() => null);
}
