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
	IconVocabulary,
} from "@tabler/icons-react";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { ThreePointSmileyRating, Verb } from "../types";
import { clientGqlService } from "./react-query";

export const getLot = (lot: unknown) => {
	if (!lot) return undefined;
	const newLot = (lot as string).toLowerCase();
	return match(newLot)
		.with("music", () => MediaLot.Music)
		.with("books", "book", () => MediaLot.Book)
		.with("anime", "animes", () => MediaLot.Anime)
		.with("manga", "mangas", () => MediaLot.Manga)
		.with("movies", "movie", () => MediaLot.Movie)
		.with("podcast", "podcasts", () => MediaLot.Podcast)
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
		.with(
			"comics",
			"comicbook",
			"comic_book",
			"comicbooks",
			"comic book",
			"comic_books",
			() => MediaLot.ComicBook,
		)
		.otherwise(() => undefined);
};

export const getVerb = (verb: Verb, lot: MediaLot) =>
	match(verb)
		.with(Verb.Read, () => {
			return match(lot)
				.with(MediaLot.Book, MediaLot.Manga, MediaLot.ComicBook, () => "read")
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
				.exhaustive();
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
		.with(MediaLot.ComicBook, () => IconVocabulary)
		.with(MediaLot.VideoGame, () => IconBrandAppleArcade)
		.exhaustive();

export const getSetColor = (l: SetLot) =>
	match(l)
		.with(SetLot.Failure, () => "red")
		.with(SetLot.Drop, () => "grape.6")
		.with(SetLot.WarmUp, () => "yellow")
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

export const formatRatingForDisplay = (
	rating: number,
	scale: UserReviewScale,
) =>
	match(scale)
		.with(UserReviewScale.OutOfTen, () => rating.toFixed(1))
		.with(UserReviewScale.OutOfFive, () => rating.toFixed(1))
		.with(UserReviewScale.ThreePointSmiley, () => rating.toFixed(2))
		.with(UserReviewScale.OutOfHundred, () =>
			Number.isInteger(rating)
				? Math.round(rating).toString()
				: rating.toFixed(1),
		)
		.exhaustive();

export const getRatingUnitSuffix = (scale: UserReviewScale) =>
	match(scale)
		.with(UserReviewScale.OutOfTen, () => "/10")
		.with(UserReviewScale.OutOfHundred, () => "%")
		.otherwise(() => undefined);

export const getExerciseDetailsPath = (exerciseId: string) =>
	$path("/fitness/exercises/item/:id", {
		id: encodeURIComponent(exerciseId),
	});

export const getPersonDetailsPath = (personId: string) =>
	$path("/media/people/item/:id", { id: personId });

export const getMetadataDetailsPath = (metadataId: string) =>
	$path("/media/item/:id", { id: metadataId });

export const getMetadataGroupDetailsPath = (groupId: string) =>
	$path("/media/groups/item/:id", { id: groupId });

type EntityColor = Record<MediaLot | (string & {}), MantineColor>;

export const MediaColors: EntityColor = {
	SHOW: "red",
	BOOK: "lime",
	MOVIE: "cyan",
	ANIME: "blue",
	MANGA: "purple",
	MUSIC: "indigo.2",
	PODCAST: "yellow",
	REVIEW: "green.5",
	WORKOUT: "violet",
	VIDEO_GAME: "teal",
	COMIC_BOOK: "grape",
	AUDIO_BOOK: "orange",
	VISUAL_NOVEL: "pink",
	USER_MEASUREMENT: "indigo",
};

export const getMetadataDetails = async (metadataId: string) =>
	clientGqlService
		.request(MetadataDetailsDocument, { metadataId })
		.then((d) => d.metadataDetails.response);
