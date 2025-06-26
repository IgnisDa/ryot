import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { dayjsLib } from "~/lib/common";

export const JUST_WATCH_URL = "https://www.justwatch.com";

export const METADATA_LOTS_WITH_GRANULAR_UPDATES = [
	MediaLot.Show,
	MediaLot.Anime,
	MediaLot.Manga,
	MediaLot.Podcast,
];

export const SECONDS_IN_MONTH = dayjsLib.duration(1, "month").asSeconds();
