import type Umami from "@bitprojects/umami-logger-typescript";
import {
	createQueryKeys,
	mergeQueryKeys,
} from "@lukemorales/query-key-factory";
import {
	MediaLot,
	MediaSource,
	MetadataDetailsDocument,
	MetadataPartialDetailsDocument,
	SetLot,
	UserMetadataDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { inRange, isString } from "@ryot/ts-utils";
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
import { QueryClient, queryOptions, skipToken } from "@tanstack/react-query";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { GraphQLClient } from "graphql-request";
import Cookies from "js-cookie";
import { match } from "ts-pattern";
import { z } from "zod";

declare global {
	interface Window {
		umami?: {
			track: typeof Umami.trackEvent;
		};
	}
}

dayjs.extend(utc);
dayjs.extend(duration);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

export { dayjs as dayjsLib };

export const commaDelimitedString = z
	.string()
	.optional()
	.transform((v) => (isString(v) ? v.split(",") : undefined));

export const emptyNumberString = z
	.any()
	.transform((v) => (!v ? undefined : Number.parseInt(v)))
	.nullable();

export const emptyDecimalString = z
	.any()
	.transform((v) => (!v ? undefined : Number.parseFloat(v).toString()))
	.nullable();

export const LOGO_IMAGE_URL =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
export const redirectToQueryParam = "redirectTo";
export const pageQueryParam = "page";
export const FRONTEND_AUTH_COOKIE_NAME = "Auth";
export const toastKey = "Toast";
export const PRO_REQUIRED_MESSAGE = "Ryot pro is required to use this feature";

export const queryClient = new QueryClient({
	defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
});

export const getDateFromTimeSpan = (timeSpan: TimeSpan) =>
	match(timeSpan)
		.with(TimeSpan.Last7Days, () => dayjs().subtract(7, "days"))
		.with(TimeSpan.Last30Days, () => dayjs().subtract(30, "days"))
		.with(TimeSpan.Last90Days, () => dayjs().subtract(90, "days"))
		.with(TimeSpan.Last365Days, () => dayjs().subtract(365, "days"))
		.with(TimeSpan.AllTime, () => null)
		.exhaustive();

export enum FitnessEntity {
	Workouts = "workouts",
	Templates = "templates",
}

export enum TimeSpan {
	Last7Days = "Last 7 days",
	Last30Days = "Last 30 days",
	Last90Days = "Last 90 days",
	Last365Days = "Last 365 days",
	AllTime = "All Time",
}

export enum ThreePointSmileyRating {
	Happy = "Happy",
	Neutral = "Neutral",
	Sad = "Sad",
}

export enum FitnessAction {
	LogWorkout = "log-workout",
	UpdateWorkout = "update-workout",
	CreateTemplate = "create-template",
}

export type AppServiceWorkerNotificationTag = "timer-completed";

export type AppServiceWorkerNotificationData = {
	event: "open-link";
	link?: string;
};

export const sendNotificationToServiceWorker = (
	title: string,
	body: string,
	tag?: AppServiceWorkerNotificationTag,
	data?: AppServiceWorkerNotificationData,
) =>
	navigator.serviceWorker.ready.then((registration) => {
		registration.showNotification(title, {
			tag,
			body,
			data,
			silent: true,
			icon: LOGO_IMAGE_URL,
		});
	});

export type AppServiceWorkerMessageData = {
	event: "remove-timer-completed-notification";
};

export const postMessageToServiceWorker = (
	message: AppServiceWorkerMessageData,
) => {
	if (navigator.serviceWorker?.controller)
		navigator.serviceWorker.controller.postMessage(message);
};

export const convertDecimalToThreePointSmiley = (rating: number) =>
	inRange(rating, 0, 33.4)
		? ThreePointSmileyRating.Sad
		: inRange(rating, 33.4, 66.8)
			? ThreePointSmileyRating.Neutral
			: ThreePointSmileyRating.Happy;

export const reviewYellow = "#EBE600FF";

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

export const getVerb = (verb: Verb, lot: MediaLot) =>
	match(verb)
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

/**
 * Generate a random color based on a seed.
 * Taken from https://stackoverflow.com/a/8134122/11667450
 */
export const generateColor = (seed: number) => {
	const color = Math.floor(Math.abs(Math.sin(seed) * 16777215));
	let newColor = color.toString(16);
	while (newColor.length < 6) newColor = `0${color}`;
	return `#${newColor}`;
};

/**
 * Convert a string to a number by adding the ascii values of the characters.
 */
export const getStringAsciiValue = (input: string) => {
	let total = 0;
	for (let i = 0; i < input.length; i++) total += input.charCodeAt(i);
	return total;
};

export const getMetadataIcon = (lot: MediaLot) =>
	match(lot)
		.with(MediaLot.Book, () => IconBook)
		.with(MediaLot.Manga, () => IconBooks)
		.with(MediaLot.Movie, () => IconDeviceTv)
		.with(MediaLot.Anime, () => IconDeviceTvOld)
		.with(MediaLot.VisualNovel, () => IconBook2)
		.with(MediaLot.Show, () => IconDeviceDesktop)
		.with(MediaLot.Podcast, () => IconMicrophone)
		.with(MediaLot.AudioBook, () => IconHeadphones)
		.with(MediaLot.VideoGame, () => IconBrandAppleArcade)
		.exhaustive();

export const applicationBaseUrl =
	typeof window !== "undefined" ? window.location.origin : "";

export const clientGqlService = new GraphQLClient(
	`${applicationBaseUrl}/backend/graphql`,
	{
		headers: () => {
			const data = Cookies.get(FRONTEND_AUTH_COOKIE_NAME);
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

const usersQueryKeys = createQueryKeys("users", {
	details: (token: string) => ({
		queryKey: ["userDetails", token],
	}),
});

const mediaQueryKeys = createQueryKeys("media", {
	metadataPartialDetails: (metadataId: string) => ({
		queryKey: ["metadataPartialDetails", metadataId],
	}),
	metadataDetails: (metadataId: string) => ({
		queryKey: ["metadataDetails", metadataId],
	}),
	userMetadataDetails: (metadataId: string) => ({
		queryKey: ["userMetadataDetails", metadataId],
	}),
	metadataGroupDetails: (metadataGroupId: string) => ({
		queryKey: ["metadataGroupDetails", metadataGroupId],
	}),
	personDetails: (personId: string) => ({
		queryKey: ["personDetails", personId],
	}),
	genreImages: (genreId: string) => ({
		queryKey: ["genreDetails", "images", genreId],
	}),
});

const collectionQueryKeys = createQueryKeys("collections", {
	userList: (userId: string) => ({
		queryKey: ["userCollectionsList", userId],
	}),
	details: (collectionId: string, take?: number) => ({
		queryKey: ["collectionDetails", collectionId, take],
	}),
	images: (collectionId: string) => ({
		queryKey: ["collectionDetails", "images", collectionId],
	}),
});

const fitnessQueryKeys = createQueryKeys("fitness", {
	exerciseDetails: (exerciseId: string) => ({
		queryKey: ["exerciseDetails", exerciseId],
	}),
	userExerciseDetails: (exerciseId: string) => ({
		queryKey: ["userExerciseDetails", exerciseId],
	}),
	workoutDetails: (workoutId: string) => ({
		queryKey: ["workoutDetails", workoutId],
	}),
	exerciseParameters: () => ({
		queryKey: ["exerciseParameters"],
	}),
	workoutTemplateDetails: (workoutTemplateId: string) => ({
		queryKey: ["workoutTemplateDetails", workoutTemplateId],
	}),
});

const miscellaneousQueryKeys = createQueryKeys("miscellaneous", {
	coreDetails: () => ({
		queryKey: ["coreDetails"],
	}),
	dailyUserActivities: (startDate?: string, endDate?: string) => ({
		queryKey: ["dailyUserActivities", startDate, endDate],
	}),
});

export const queryFactory = mergeQueryKeys(
	usersQueryKeys,
	mediaQueryKeys,
	collectionQueryKeys,
	fitnessQueryKeys,
	miscellaneousQueryKeys,
);

export const getPartialMetadataDetailsQuery = (metadataId: string) =>
	queryOptions({
		queryKey: queryFactory.media.metadataPartialDetails(metadataId).queryKey,
		queryFn: () =>
			clientGqlService
				.request(MetadataPartialDetailsDocument, { metadataId })
				.then((data) => data.metadataPartialDetails),
	});

export const getMetadataDetailsQuery = (metadataId?: string | null) =>
	queryOptions({
		queryKey: queryFactory.media.metadataDetails(metadataId || "").queryKey,
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(MetadataDetailsDocument, { metadataId })
						.then((data) => data.metadataDetails)
			: skipToken,
		staleTime: dayjs.duration(1, "day").asMilliseconds(),
	});

export const getUserMetadataDetailsQuery = (metadataId?: string | null) =>
	queryOptions({
		queryKey: queryFactory.media.userMetadataDetails(metadataId || "").queryKey,
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(UserMetadataDetailsDocument, { metadataId })
						.then((data) => data.userMetadataDetails)
			: skipToken,
	});

export const getTimeOfDay = (hours: number) => {
	if (hours >= 5 && hours < 12) return "Morning";
	if (hours >= 12 && hours < 17) return "Afternoon";
	if (hours >= 17 && hours < 21) return "Evening";
	return "Night";
};

export const refreshUserMetadataDetails = (metadataId: string) =>
	setTimeout(() => {
		queryClient.invalidateQueries({
			queryKey: queryFactory.media.userMetadataDetails(metadataId).queryKey,
		});
	}, 1500);
