import type { MantineColor } from "@mantine/core";
import {
	MediaLot,
	MetadataDetailsDocument,
	SetLot,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { inRange } from "@ryot/ts-utils";
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
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { ThreePointSmileyRating, Verb } from "../types";
import { clientGqlService } from "./react-query";

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

export const getSetColor = (l: SetLot) =>
	match(l)
		.with(SetLot.WarmUp, () => "yellow")
		.with(SetLot.Drop, () => "grape.6")
		.with(SetLot.Failure, () => "red")
		.with(SetLot.Normal, () => "indigo.6")
		.exhaustive();

export const convertDecimalToThreePointSmiley = (rating: number) =>
	inRange(rating, 0, 33.4)
		? ThreePointSmileyRating.Sad
		: inRange(rating, 33.4, 66.8)
			? ThreePointSmileyRating.Neutral
			: ThreePointSmileyRating.Happy;

export const convertRatingToUserScale = (
	rating: string | null | undefined,
	scale: UserReviewScale,
) => {
	if (rating == null) return null;
	const value = Number(rating);
	if (Number.isNaN(value)) return null;

	const scaled = match(scale)
		.with(UserReviewScale.OutOfHundred, () => value)
		.with(UserReviewScale.OutOfTen, () => value / 10)
		.with(UserReviewScale.OutOfFive, () => value / 20)
		.with(UserReviewScale.ThreePointSmiley, () => value)
		.exhaustive();
	return scale === UserReviewScale.OutOfHundred ||
		scale === UserReviewScale.ThreePointSmiley
		? scaled
		: Math.round(scaled * 10) / 10;
};

export const convertUserScaleToRating = (
	rating: number | string | null | undefined,
	scale: UserReviewScale,
) => {
	if (rating == null) return null;
	const value = Number(rating);
	if (Number.isNaN(value)) return null;

	return match(scale)
		.with(UserReviewScale.OutOfHundred, () => value)
		.with(UserReviewScale.OutOfTen, () => value * 10)
		.with(UserReviewScale.OutOfFive, () => value * 20)
		.with(UserReviewScale.ThreePointSmiley, () => value)
		.exhaustive();
};

export const formatRatingForDisplay = (
	rating: number,
	scale: UserReviewScale,
) =>
	match(scale)
		.with(UserReviewScale.OutOfHundred, () =>
			Number.isInteger(rating)
				? Math.round(rating).toString()
				: rating.toFixed(1),
		)
		.with(UserReviewScale.OutOfTen, () => rating.toFixed(1))
		.with(UserReviewScale.OutOfFive, () => rating.toFixed(1))
		.with(UserReviewScale.ThreePointSmiley, () => rating.toFixed(2))
		.exhaustive();

export const getRatingUnitSuffix = (scale: UserReviewScale) =>
	match(scale)
		.with(UserReviewScale.OutOfHundred, () => "%")
		.with(UserReviewScale.OutOfTen, () => "/10")
		.otherwise(() => undefined);

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

export const getMetadataDetails = async (metadataId: string) =>
	clientGqlService
		.request(MetadataDetailsDocument, { metadataId })
		.then((d) => d.metadataDetails.response);
