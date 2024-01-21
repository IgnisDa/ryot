import type { MantineColorScheme } from "@mantine/core";
import {
	GetPresignedS3UrlDocument,
	MetadataLot,
	MetadataSource,
	PresignedPutS3UrlDocument,
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
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import { GraphQLClient } from "graphql-request";
import { match } from "ts-pattern";

dayjs.extend(relativeTime);
dayjs.extend(duration);
dayjs.extend(localizedFormat);

export const getApplicationKeyAccessor = (keyName: number) => {
	const base1 = btoa(keyName.toString());
	const base2 = btoa(base1);
	return `ryot_${base2}`.replaceAll(/=/g, "eq");
};

export const ApplicationKey = {
	Auth: getApplicationKeyAccessor(0),
	ColorScheme: getApplicationKeyAccessor(1),
	IsWorkoutInProgress: getApplicationKeyAccessor(2),
	SavedMeasurementsDisplaySelectedStats: getApplicationKeyAccessor(3),
	SavedOpenedLinkGroups: getApplicationKeyAccessor(4),
	DefaultExerciseRestTimer: getApplicationKeyAccessor(5),
	CurrentWorkout: getApplicationKeyAccessor(6),
};

export const gqlClientSide = new GraphQLClient("/backend/graphql", {
	credentials: "include",
});

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
		.with("anime", "animes", () => MetadataLot.Anime)
		.with("manga", "mangas", () => MetadataLot.Manga)
		.with("books", "book", () => MetadataLot.Book)
		.with("movies", "movie", () => MetadataLot.Movie)
		.with("tv", "show", "shows", () => MetadataLot.Show)
		.with(
			"visual_novel",
			"visualnovel",
			"visual novel",
			() => MetadataLot.VisualNovel,
		)
		.with(
			"games",
			"videogames",
			"videogame",
			"video_game",
			"video game",
			"video_games",
			() => MetadataLot.VideoGame,
		)
		.with(
			"audio book",
			"audiobooks",
			"audiobook",
			"audio_book",
			"audio_books",
			() => MetadataLot.AudioBook,
		)
		.with("podcast", "podcasts", () => MetadataLot.Podcast)
		.otherwise(() => undefined);
};

export const getLotGradient = (lot: MetadataLot) =>
	match(lot)
		.with(MetadataLot.AudioBook, () => ({ from: "indigo", to: "cyan" }))
		.with(MetadataLot.Book, () => ({ from: "teal", to: "lime" }))
		.with(MetadataLot.Movie, () => ({ from: "teal", to: "blue" }))
		.with(MetadataLot.Show, () => ({ from: "orange", to: "red" }))
		.with(MetadataLot.VideoGame, () => ({
			from: "purple",
			to: "blue",
		}))
		.with(MetadataLot.Anime, () => ({
			from: "red",
			to: "blue",
		}))
		.with(MetadataLot.Manga, () => ({
			from: "red",
			to: "green",
		}))
		.with(MetadataLot.Podcast, () => ({
			from: "yellow",
			to: "purple",
		}))
		.with(MetadataLot.VisualNovel, () => ({
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
					MetadataLot.VisualNovel,
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
		.with(MetadataLot.VisualNovel, () => IconBook2)
		.exhaustive();
};

export const uploadFileAndGetKey = async (
	fileName: string,
	prefix: string,
	contentType: string,
	body: ArrayBuffer | Buffer,
) => {
	const { presignedPutS3Url } = await gqlClientSide.request(
		PresignedPutS3UrlDocument,
		{ input: { fileName, prefix } },
	);
	await fetch(presignedPutS3Url.uploadUrl, {
		method: "PUT",
		body,
		headers: { "Content-Type": contentType },
	});
	return presignedPutS3Url.key;
};

export const getPresignedGetUrl = async (key: string) => {
	const { getPresignedS3Url } = await gqlClientSide.request(
		GetPresignedS3UrlDocument,
		{ key },
	);
	return getPresignedS3Url;
};

export const uploadFileToServiceAndGetPath = async (
	file: File,
	onProgress: (event: ProgressEvent<XMLHttpRequestEventTarget>) => void,
	onLoad: () => void,
) => {
	const formData = new FormData();
	formData.append("files[]", file, file.name);
	const data: string = await new Promise((resolve) => {
		const xhr = new XMLHttpRequest();
		xhr.upload.addEventListener("progress", (event) => {
			if (event.lengthComputable) onProgress(event);
		});
		xhr.addEventListener("load", () => {
			onLoad();
			const data: string[] = JSON.parse(xhr.responseText);
			resolve(data[0]);
		});
		xhr.open("POST", "/backend/upload", true);
		xhr.send(formData);
	});
	return data;
};

export const deserializeLocalStorage = (value: string | undefined) => {
	if (value === "__undefined") return undefined;
	return value;
};

export const serializeLocalStorage = (value: string | undefined) => {
	if (typeof value === "undefined") return "__undefined";
	return value;
};

export { dayjs as dayjsLib };

export const redirectToQueryParam = "redirectTo";
