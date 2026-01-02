import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
	MediaSource,
	PresignedPutS3UrlDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { clientGqlService } from "./react-query";

export const forcedDashboardPath = $path("/", { ignoreLandingPath: true });

export const generateColor = (seed: number) => {
	const color = Math.floor(Math.abs(Math.sin(seed) * 16777215));
	let newColor = color.toString(16);
	while (newColor.length < 6) newColor = `0${color}`;
	return `#${newColor}`;
};

export const getStringAsciiValue = (input: string) => {
	let total = 0;
	for (let i = 0; i < input.length; i++) total += input.charCodeAt(i);
	return total;
};

export const selectRandomElement = <T,>(array: T[], input: string): T =>
	array[(getStringAsciiValue(input) + array.length) % array.length];

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

export const openConfirmationModal = (title: string, onConfirm: () => void) =>
	modals.openConfirmModal({
		title: "Confirmation",
		onConfirm: onConfirm,
		children: <Text size="sm">{title}</Text>,
		labels: { confirm: "Confirm", cancel: "Cancel" },
	});

export const clientSideFileUpload = async (file: File, prefix: string) => {
	const body = await file.arrayBuffer();
	const { presignedPutS3Url } = await clientGqlService.request(
		PresignedPutS3UrlDocument,
		{ prefix },
	);
	await fetch(presignedPutS3Url.uploadUrl, {
		body,
		method: "PUT",
		headers: { "Content-Type": file.type },
	});
	return presignedPutS3Url.key;
};

export const convertEnumToSelectData = (value: { [id: number]: string }) =>
	Object.values(value).map((v) => ({
		value: v,
		label: startCase(v.toString().toLowerCase()),
	}));

export const triggerDownload = (url: string, filename: string) => {
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
};

export const getProviderSourceImage = (source: MediaSource) =>
	match(source)
		.with(MediaSource.Anilist, () => "anilist.svg")
		.with(MediaSource.Audible, () => "audible.svg")
		.with(MediaSource.GoogleBooks, () => "google-books.svg")
		.with(MediaSource.Igdb, () => "igdb.svg")
		.with(MediaSource.Itunes, () => "itunes.svg")
		.with(MediaSource.Listennotes, () => "listennotes.webp")
		.with(MediaSource.Myanimelist, () => "myanimelist.svg")
		.with(MediaSource.MangaUpdates, () => "manga-updates.svg")
		.with(MediaSource.Openlibrary, () => "openlibrary.svg")
		.with(MediaSource.Tmdb, () => "tmdb.svg")
		.with(MediaSource.Tvdb, () => "tvdb.svg")
		.with(MediaSource.Vndb, () => "vndb.ico")
		.with(MediaSource.YoutubeMusic, () => "youtube-music.png")
		.with(MediaSource.Hardcover, () => "hardcover.png")
		.with(MediaSource.GiantBomb, () => "giant-bomb.jpeg")
		.with(MediaSource.Spotify, () => "spotify.svg")
		.with(MediaSource.Custom, () => undefined)
		.exhaustive();
