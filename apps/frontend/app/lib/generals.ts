import {
	createQueryKeys,
	mergeQueryKeys,
} from "@lukemorales/query-key-factory";
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
import { GraphQLClient } from "graphql-request";
import Cookies from "js-cookie";
import { match } from "ts-pattern";

dayjs.extend(relativeTime);
dayjs.extend(duration);
dayjs.extend(localizedFormat);

export { dayjs as dayjsLib };

export const CurrentWorkoutKey = "CurrentWorkout";
export const LOGO_IMAGE_URL =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
export const redirectToQueryParam = "redirectTo";
export const AUTH_COOKIE_NAME = "Auth";
export const USER_PREFERENCES_COOKIE_NAME = "UserPreferences";
export const CORE_DETAILS_COOKIE_NAME = "CoreDetails";
export const USER_DETAILS_COOKIE_NAME = "UserDetails";

const enhancedSearchParamCookie = "SearchParams__";
export const enhancedCookieName = (name: string) =>
	`${enhancedSearchParamCookie}${name}`;

export const queryClient = new QueryClient();

export const getSetColor = (l: SetLot) =>
	match(l)
		.with(SetLot.WarmUp, () => "yellow")
		.with(SetLot.Drop, () => "grape.6")
		.with(SetLot.Failure, () => "red")
		.with(SetLot.Normal, () => "indigo.6")
		.exhaustive();

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

const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

export const clientGqlService = new GraphQLClient(
	`${baseUrl}/backend/graphql`,
	{
		headers: () => {
			const data = Cookies.get(AUTH_COOKIE_NAME);
			return { authorization: data ? `Bearer ${data}` : "" };
		},
	},
);

export const getSurroundingElements = <T>(
	array: Array<T>,
	elementIndex: number,
): Array<number> => {
	if (array.length === 1) return [0];
	const lastIndex = array.length - 1;
	if (elementIndex === 0) return [lastIndex, elementIndex, elementIndex + 1];
	if (elementIndex === lastIndex) return [elementIndex - 1, elementIndex, 0];
	return [elementIndex - 1, elementIndex, elementIndex + 1];
};

const mediaQueryKeys = createQueryKeys("media", {
	metadataDetails: (metadataId: string) => ({
		queryKey: ["metadataDetails", metadataId],
	}),
	userMetadataDetails: (metadataId: string) => ({
		queryKey: ["userMetadataDetails", metadataId],
	}),
});

const collectionQueryKeys = createQueryKeys("collections", {
	userList: (userId: string) => ({
		queryKey: ["userCollectionsList", userId],
	}),
	details: (collectionId: string) => ({
		queryKey: ["collectionDetails", collectionId],
	}),
});

const fitnessQueryKeys = createQueryKeys("fitness", {
	exerciseDetails: (exerciseId: string) => ({
		queryKey: ["exerciseDetails", exerciseId],
	}),
	userExerciseDetails: (exerciseId: string) => ({
		queryKey: ["userExerciseDetails", exerciseId],
	}),
});

export const queryFactory = mergeQueryKeys(
	mediaQueryKeys,
	collectionQueryKeys,
	fitnessQueryKeys,
);
