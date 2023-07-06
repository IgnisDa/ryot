import {
	MetadataLot,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconBook,
	IconBooks,
	IconBrandAppleArcade,
	IconDeviceDesktop,
	IconDeviceTv,
	IconDeviceTvOld,
	IconHeadphones,
	IconMicrophone,
} from "@tabler/icons-react";
import { match } from "ts-pattern";

/**
 * Get the correct name of the lot from a string
 */
export const getLot = (lot: unknown) => {
	if (!lot) return undefined;
	const newLot = (lot as string).toLowerCase();
	return match(newLot)
		.with("anime", "animes", () => MetadataLot.Anime)
		.with("manga", "mangas", () => MetadataLot.Manga)
		.with("books", "book", () => MetadataLot.Book)
		.with("movies", "movie", () => MetadataLot.Movie)
		.with("tv", "show", "shows", () => MetadataLot.Show)
		.with(
			"games",
			"videogames",
			"video_game",
			"video game",
			"video_games",
			() => MetadataLot.VideoGame,
		)
		.with(
			"audio book",
			"audiobooks",
			"audio_book",
			"audio_books",
			() => MetadataLot.AudioBook,
		)
		.with("podcast", "podcasts", () => MetadataLot.Podcast)
		.otherwise(() => undefined);
};

/**
 * Get the correct source from a string
 */
export const getSource = (source: unknown) => {
	if (!source) return undefined;
	const newLot = (source as string).toLowerCase();
	return match(newLot)
		.with("anilist", () => MetadataSource.Anilist)
		.with("audible", () => MetadataSource.Audible)
		.with("custom", () => MetadataSource.Custom)
		.with("igdb", () => MetadataSource.Igdb)
		.with("listennotes", () => MetadataSource.Listennotes)
		.with("openlibrary", () => MetadataSource.Openlibrary)
		.with("tmdb", () => MetadataSource.Tmdb)
		.otherwise(() => undefined);
};

export enum Verb {
	Read = 0,
}

export const getVerb = (verb: Verb, lot: MetadataLot) => {
	return match(verb)
		.with(Verb.Read, () => {
			return match(lot)
				.with(MetadataLot.Book, MetadataLot.Manga, () => "read")
				.with(
					MetadataLot.Movie,
					MetadataLot.Show,
					MetadataLot.Anime,
					() => "watch",
				)
				.with(
					MetadataLot.AudioBook,
					MetadataLot.VideoGame,
					MetadataLot.Podcast,
					() => "play",
				)
				.otherwise(() => {
					return "";
				});
		})
		.otherwise(() => "");
};

/**
 * Convert a file to its base64 representation.
 */
export const fileToText = (file: File): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.readAsText(file);
		reader.onload = () => resolve(reader.result?.toString() || "");
		reader.onerror = reject;
	});

/**
 * Generate a random color based on a seed.
 * Taken from https://stackoverflow.com/a/8134122/11667450
 */
export const generateColor = (seed: number) => {
	const color = Math.floor(Math.abs(Math.sin(seed) * 16777215));
	let newColor = color.toString(16);
	while (newColor.length < 6) {
		newColor = `0${color}`;
	}
	return `#${newColor}`;
};

/**
 * Convert a string to a number by adding the ascii values of the characters.
 */
export const getStringAsciiValue = (input: string) => {
	let total = 0;
	for (let i = 0; i < input.length; i++) {
		total += input.charCodeAt(i);
	}
	return total;
};

export const getMetadataIcon = (lot: MetadataLot) => {
	return match(lot)
		.with(MetadataLot.Book, () => IconBook)
		.with(MetadataLot.Movie, () => IconDeviceTv)
		.with(MetadataLot.Show, () => IconDeviceDesktop)
		.with(MetadataLot.VideoGame, () => IconBrandAppleArcade)
		.with(MetadataLot.AudioBook, () => IconHeadphones)
		.with(MetadataLot.Podcast, () => IconMicrophone)
		.with(MetadataLot.Manga, () => IconDeviceTvOld)
		.with(MetadataLot.Anime, () => IconBooks)
		.exhaustive();
};
