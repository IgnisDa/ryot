import {
	createQueryKeys,
	mergeQueryKeys,
} from "@lukemorales/query-key-factory";
import { type MantineColor, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
	type CollectionRecommendationsInput,
	type MediaCollectionFilter,
	type MediaCollectionPresenceFilter,
	MediaLot,
	MetadataDetailsDocument,
	MetadataGroupDetailsDocument,
	PersonDetailsDocument,
	PresignedPutS3UrlDocument,
	SetLot,
	type UserAnalyticsQueryVariables,
	UserMetadataDetailsDocument,
	UserMetadataGroupDetailsDocument,
	UserPersonDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { inRange, isString, startCase } from "@ryot/ts-utils";
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
	IconMusic,
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
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { z } from "zod";

declare global {
	interface Window {
		umami?: { track: (eventName: string, eventData: unknown) => void };
	}
}

dayjs.extend(utc);
dayjs.extend(duration);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

export { dayjs as dayjsLib };

export const MEDIA_DETAILS_HEIGHT = { base: "45vh", "2xl": "55vh" };

type TimestampToStringResult<T> = T extends Date | string ? string : null;

export const convertTimestampToUtcString = <
	T extends Date | string | null | undefined,
>(
	dateTime: T,
): TimestampToStringResult<T> => {
	if (!dateTime) return null as TimestampToStringResult<T>;

	const parsed = dayjs(dateTime);
	if (!parsed.isValid()) return null as TimestampToStringResult<T>;

	return parsed.utc().format() as TimestampToStringResult<T>;
};

export const zodCommaDelimitedString = z
	.string()
	.optional()
	.transform((v) => (isString(v) ? v.split(",") : undefined));

export const zodEmptyNumberString = z
	.any()
	.transform((v) => (!v ? undefined : Number.parseInt(v)))
	.nullable();

export const zodEmptyDecimalString = z
	.any()
	.transform((v) => (!v ? undefined : Number.parseFloat(v).toString()))
	.nullable();

export const zodCollectionFilter = zodCommaDelimitedString.transform(
	(v) =>
		(v || [])
			.map((s) => {
				const [collectionId, presence] = s.split(":");
				if (!collectionId || !presence) return undefined;
				return {
					collectionId,
					presence: presence as MediaCollectionPresenceFilter,
				};
			})
			.filter(Boolean) as MediaCollectionFilter[],
);

export const zodDateTimeString = z
	.string()
	.transform((v) => convertTimestampToUtcString(v));

export const LOGO_IMAGE_URL =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
export const redirectToQueryParam = "redirectTo";
export const pageQueryParam = "page";
export const FRONTEND_AUTH_COOKIE_NAME = "Auth";
export const toastKey = "Toast";
export const PRO_REQUIRED_MESSAGE = "Ryot pro is required to use this feature";
export const CURRENT_WORKOUT_KEY = "CurrentWorkout";

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

export const forcedDashboardPath = $path("/", { ignoreLandingPath: "true" });

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
		.with("music", () => MediaLot.Music)
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
					MediaLot.Music,
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

export function selectRandomElement<T>(array: T[], input: string): T {
	// taken from https://stackoverflow.com/questions/44975435/using-mod-operator-in-javascript-to-wrap-around#comment76926119_44975435
	return array[(getStringAsciiValue(input) + array.length) % array.length];
}

export const getMetadataIcon = (lot: MediaLot) =>
	match(lot)
		.with(MediaLot.Book, () => IconBook)
		.with(MediaLot.Manga, () => IconBooks)
		.with(MediaLot.Music, () => IconMusic)
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

export function getSurroundingElements<T>(
	array: Array<T>,
	elementIndex: number,
): Array<number> {
	if (array.length === 1) return [0];
	const lastIndex = array.length - 1;
	if (elementIndex === 0) return [lastIndex, elementIndex, elementIndex + 1];
	if (elementIndex === lastIndex) return [elementIndex - 1, elementIndex, 0];
	return [elementIndex - 1, elementIndex, elementIndex + 1];
}

const mediaQueryKeys = createQueryKeys("media", {
	metadataDetails: (metadataId?: string) => ({
		queryKey: ["metadataDetails", metadataId],
	}),
	userMetadataDetails: (metadataId?: string) => ({
		queryKey: ["userMetadataDetails", metadataId],
	}),
	metadataGroupDetails: (metadataGroupId?: string) => ({
		queryKey: ["metadataGroupDetails", metadataGroupId],
	}),
	userMetadataGroupDetails: (metadataGroupId?: string) => ({
		queryKey: ["userMetadataGroupDetails", metadataGroupId],
	}),
	personDetails: (personId?: string) => ({
		queryKey: ["personDetails", personId],
	}),
	userPersonDetails: (personId?: string) => ({
		queryKey: ["userPersonDetails", personId],
	}),
	genreImages: (genreId: string) => ({
		queryKey: ["genreDetails", "images", genreId],
	}),
	trendingMetadata: () => ({
		queryKey: ["trendingMetadata"],
	}),
	userMetadataRecommendations: () => ({
		queryKey: ["userMetadataRecommendations"],
	}),
});

const collectionQueryKeys = createQueryKeys("collections", {
	images: (collectionId: string) => ({
		queryKey: ["collectionDetails", "images", collectionId],
	}),
	recommendations: (input: CollectionRecommendationsInput) => ({
		queryKey: ["collectionRecommendations", input],
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
	workoutTemplateDetails: (workoutTemplateId: string) => ({
		queryKey: ["workoutTemplateDetails", workoutTemplateId],
	}),
});

const miscellaneousQueryKeys = createQueryKeys("miscellaneous", {
	userAnalytics: (input: UserAnalyticsQueryVariables) => ({
		queryKey: ["userAnalytics", input],
	}),
	presignedS3Url: (key: string) => ({
		queryKey: ["presignedS3Url", key],
	}),
});

export const queryFactory = mergeQueryKeys(
	mediaQueryKeys,
	fitnessQueryKeys,
	collectionQueryKeys,
	miscellaneousQueryKeys,
);

export const getMetadataDetailsQuery = (metadataId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.metadataDetails(metadataId).queryKey,
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(MetadataDetailsDocument, { metadataId })
						.then((data) => data.metadataDetails)
			: skipToken,
	});

export const getUserMetadataDetailsQuery = (metadataId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.userMetadataDetails(metadataId).queryKey,
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(UserMetadataDetailsDocument, { metadataId })
						.then((data) => data.userMetadataDetails)
			: skipToken,
	});

export const getPersonDetailsQuery = (personId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.personDetails(personId).queryKey,
		queryFn: personId
			? () =>
					clientGqlService
						.request(PersonDetailsDocument, { personId })
						.then((data) => data.personDetails)
			: skipToken,
	});

export const getUserPersonDetailsQuery = (personId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.userPersonDetails(personId).queryKey,
		queryFn: personId
			? () =>
					clientGqlService
						.request(UserPersonDetailsDocument, { personId })
						.then((data) => data.userPersonDetails)
			: skipToken,
	});

export const getMetadataGroupDetailsQuery = (metadataGroupId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.metadataGroupDetails(metadataGroupId).queryKey,
		queryFn: metadataGroupId
			? () =>
					clientGqlService
						.request(MetadataGroupDetailsDocument, { metadataGroupId })
						.then((data) => data.metadataGroupDetails)
			: skipToken,
	});

export const getUserMetadataGroupDetailsQuery = (metadataGroupId?: string) =>
	queryOptions({
		queryKey:
			queryFactory.media.userMetadataGroupDetails(metadataGroupId).queryKey,
		queryFn: metadataGroupId
			? () =>
					clientGqlService
						.request(UserMetadataGroupDetailsDocument, { metadataGroupId })
						.then((data) => data.userMetadataGroupDetails)
			: skipToken,
	});

export const getTimeOfDay = (hours: number) => {
	if (hours >= 5 && hours < 12) return "Morning";
	if (hours >= 12 && hours < 17) return "Afternoon";
	if (hours >= 17 && hours < 21) return "Evening";
	return "Night";
};

export const refreshEntityDetails = (entityId: string) =>
	setTimeout(async () => {
		await Promise.all(
			[
				queryFactory.media.userMetadataDetails(entityId).queryKey,
				queryFactory.media.metadataDetails(entityId).queryKey,
				queryFactory.media.userMetadataGroupDetails(entityId).queryKey,
				queryFactory.media.metadataGroupDetails(entityId).queryKey,
				queryFactory.media.userPersonDetails(entityId).queryKey,
				queryFactory.media.personDetails(entityId).queryKey,
			].map((q) => queryClient.invalidateQueries({ queryKey: q })),
		);
	}, 1500);

export const convertUtcHourToLocalHour = (
	utcHour: number,
	userTimezone?: string,
) => {
	const targetTimezone = userTimezone || dayjs.tz.guess();
	const utcDate = dayjs.utc().hour(utcHour).minute(0).second(0);
	const localDate = utcDate.tz(targetTimezone);
	return localDate.hour();
};

export const getExerciseDetailsPath = (exerciseId: string) =>
	$path("/fitness/exercises/item/:id", {
		id: encodeURIComponent(exerciseId),
	});

type EntityColor = Record<MediaLot | (string & {}), MantineColor>;

export const MediaColors: EntityColor = {
	ANIME: "blue",
	MUSIC: "indigo.2",
	AUDIO_BOOK: "orange",
	BOOK: "lime",
	MANGA: "purple",
	MOVIE: "cyan",
	PODCAST: "yellow",
	SHOW: "red",
	VISUAL_NOVEL: "pink",
	VIDEO_GAME: "teal",
	WORKOUT: "violet",
	REVIEW: "green.5",
	USER_MEASUREMENT: "indigo",
};

export const openConfirmationModal = (title: string, onConfirm: () => void) =>
	modals.openConfirmModal({
		title: "Confirmation",
		onConfirm: onConfirm,
		children: <Text size="sm">{title}</Text>,
		labels: { confirm: "Confirm", cancel: "Cancel" },
	});

export enum ApplicationTimeRange {
	Yesterday = "Yesterday",
	Past7Days = "Past 7 Days",
	Past30Days = "Past 30 Days",
	Past6Months = "Past 6 Months",
	Past12Months = "Past 12 Months",
	ThisWeek = "This Week",
	ThisMonth = "This Month",
	ThisYear = "This Year",
	AllTime = "All Time",
	Custom = "Custom",
}

export const getStartTimeFromRange = (range: ApplicationTimeRange) =>
	match(range)
		.with(ApplicationTimeRange.Yesterday, () => dayjs().subtract(1, "day"))
		.with(ApplicationTimeRange.ThisWeek, () => dayjs().startOf("week"))
		.with(ApplicationTimeRange.ThisMonth, () => dayjs().startOf("month"))
		.with(ApplicationTimeRange.ThisYear, () => dayjs().startOf("year"))
		.with(ApplicationTimeRange.Past7Days, () => dayjs().subtract(7, "day"))
		.with(ApplicationTimeRange.Past30Days, () => dayjs().subtract(30, "day"))
		.with(ApplicationTimeRange.Past6Months, () => dayjs().subtract(6, "month"))
		.with(ApplicationTimeRange.Past12Months, () =>
			dayjs().subtract(12, "month"),
		)
		.with(
			ApplicationTimeRange.AllTime,
			ApplicationTimeRange.Custom,
			() => undefined,
		)
		.exhaustive();

export const clientSideFileUpload = async (file: File, prefix: string) => {
	const body = await file.arrayBuffer();
	const { presignedPutS3Url } = await clientGqlService.request(
		PresignedPutS3UrlDocument,
		{ input: { fileName: file.name, prefix } },
	);
	await fetch(presignedPutS3Url.uploadUrl, {
		method: "PUT",
		body,
		headers: { "Content-Type": file.type },
	});
	return presignedPutS3Url.key;
};

export const convertEnumToSelectData = (value: {
	[id: number]: string;
}) =>
	Object.values(value).map((v) => ({
		value: v,
		label: startCase(v.toString().toLowerCase()),
	}));
