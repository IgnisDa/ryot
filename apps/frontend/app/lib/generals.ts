import type { MantineColorScheme } from "@mantine/core";
import {
	MediaLot,
	MediaSource,
	SetLot,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconBook,
	IconBook2,
	IconBooks,
	IconBrandAppleArcade,
	IconDeviceDesktop,
	IconDeviceTv,
	IconDeviceTvOld,
	IconHeadphones,
	IconMicrophone,
} from "@tabler/icons-react";
import { QueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import { match } from "ts-pattern";

dayjs.extend(relativeTime);
dayjs.extend(duration);
dayjs.extend(localizedFormat);

export const CurrentWorkoutKey = "CurrentWorkout";
export const LOGO_IMAGE_URL =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";

export const getSetColor = (l: SetLot) =>
	match(l)
		.with(SetLot.WarmUp, () => "yellow")
		.with(SetLot.Drop, () => "grape.6")
		.with(SetLot.Failure, () => "red")
		.with(SetLot.Normal, () => "indigo.6")
		.exhaustive();

export const getFallbackImageUrl = (
	colorScheme: Exclude<MantineColorScheme, "auto">,
	text = "No Image",
) =>
	`https://placehold.co/100x200/${
		colorScheme === "dark" ? "343632" : "c1c4bb"
	}/${colorScheme === "dark" ? "FFF" : "121211"}?text=${text}`;

/**
 * Get the correct name of the lot from a string
 */
export const getLot = (lot: unknown) => {
	if (!lot) return undefined;
	const newLot = (lot as string).toLowerCase();
	return match(newLot)
		.with("anime", "animes", () => MediaLot.Anime)
		.with("manga", "mangas", () => MediaLot.Manga)
		.with("books", "book", () => MediaLot.Book)
		.with("movies", "movie", () => MediaLot.Movie)
		.with("tv", "show", "shows", () => MediaLot.Show)
		.with(
			"visual_novel",
			"visualnovel",
			"visual novel",
			() => MediaLot.VisualNovel,
		)
		.with(
			"games",
			"videogames",
			"videogame",
			"video_game",
			"video game",
			"video_games",
			() => MediaLot.VideoGame,
		)
		.with(
			"audio book",
			"audiobooks",
			"audiobook",
			"audio_book",
			"audio_books",
			() => MediaLot.AudioBook,
		)
		.with("podcast", "podcasts", () => MediaLot.Podcast)
		.otherwise(() => undefined);
};

export const getLotGradient = (lot: MediaLot) =>
	match(lot)
		.with(MediaLot.AudioBook, () => ({ from: "indigo", to: "cyan" }))
		.with(MediaLot.Book, () => ({ from: "teal", to: "lime" }))
		.with(MediaLot.Movie, () => ({ from: "teal", to: "blue" }))
		.with(MediaLot.Show, () => ({ from: "orange", to: "red" }))
		.with(MediaLot.VideoGame, () => ({
			from: "purple",
			to: "blue",
		}))
		.with(MediaLot.Anime, () => ({
			from: "red",
			to: "blue",
		}))
		.with(MediaLot.Manga, () => ({
			from: "red",
			to: "green",
		}))
		.with(MediaLot.Podcast, () => ({
			from: "yellow",
			to: "purple",
		}))
		.with(MediaLot.VisualNovel, () => ({
			from: "green",
			to: "yellow",
		}))
		.exhaustive();

/**
 * Get the correct source from a string
 */
export const getSource = (source: unknown) => {
	if (!source) return undefined;
	const newLot = (source as string).toLowerCase();
	return match(newLot)
		.with("anilist", () => MediaSource.Anilist)
		.with("audible", () => MediaSource.Audible)
		.with("custom", () => MediaSource.Custom)
		.with("igdb", () => MediaSource.Igdb)
		.with("listennotes", () => MediaSource.Listennotes)
		.with("openlibrary", () => MediaSource.Openlibrary)
		.with("tmdb", () => MediaSource.Tmdb)
		.otherwise(() => undefined);
};

export enum Verb {
	Read = 0,
}

export const getVerb = (verb: Verb, lot: MediaLot) => {
	return match(verb)
		.with(Verb.Read, () => {
			return match(lot)
				.with(MediaLot.Book, MediaLot.Manga, () => "read")
				.with(
					MediaLot.Movie,
					MediaLot.Show,
					MediaLot.Anime,
					MediaLot.VisualNovel,
					() => "watch",
				)
				.with(
					MediaLot.AudioBook,
					MediaLot.VideoGame,
					MediaLot.Podcast,
					() => "play",
				)
				.otherwise(() => {
					return "";
				});
		})
		.otherwise(() => "");
};

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

export const getMetadataIcon = (lot: MediaLot) => {
	return match(lot)
		.with(MediaLot.Book, () => IconBook)
		.with(MediaLot.Movie, () => IconDeviceTv)
		.with(MediaLot.Show, () => IconDeviceDesktop)
		.with(MediaLot.VideoGame, () => IconBrandAppleArcade)
		.with(MediaLot.AudioBook, () => IconHeadphones)
		.with(MediaLot.Podcast, () => IconMicrophone)
		.with(MediaLot.Manga, () => IconDeviceTvOld)
		.with(MediaLot.Anime, () => IconBooks)
		.with(MediaLot.VisualNovel, () => IconBook2)
		.exhaustive();
};

export { dayjs as dayjsLib };

export const redirectToQueryParam = "redirectTo";

export const queryClient = new QueryClient();
