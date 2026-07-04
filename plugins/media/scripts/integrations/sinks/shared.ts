import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	failureResult,
	nestedNumber,
	nestedString,
	progressPercent,
	progressResult,
	resolvedRef,
	showLocator,
	specifics,
} from "../shared";

export const parseMediaServer = (
	provider: "Emby" | "Jellyfin",
	rawBody: string,
	integrationSpecifics: unknown,
) =>
	Effect.try(() => {
		const payload = JSON.parse(rawBody) as unknown;
		const itemType = nestedString(payload, ["ItemType", "Type", "MediaType"])?.toLowerCase();
		let entitySchemaSlug: "movie" | "show" | null = null;
		if (itemType === "movie") {
			entitySchemaSlug = "movie";
		}
		if (itemType === "episode") {
			entitySchemaSlug = "show";
		}
		if (!entitySchemaSlug) {
			return failureResult(`${provider} webhook payload has an unsupported media type`);
		}
		const settings = specifics(integrationSpecifics);
		if (provider === "Jellyfin" && typeof settings?.["username"] === "string") {
			const username =
				nestedString(payload, ["Name"]) ?? nestedString(payload, ["NotificationUsername"]);
			if (username !== settings["username"]) {
				return { failures: [], entityGroups: [] };
			}
		}
		const percent = progressPercent(
			nestedNumber(
				payload,
				provider === "Jellyfin" ? ["PlaybackPositionTicks", "PositionTicks"] : ["PositionTicks"],
			),
			nestedNumber(payload, ["RunTimeTicks"]),
		);
		if (percent === undefined) {
			return failureResult(`${provider} webhook payload is missing playback timing data`);
		}
		const metadataProvider =
			provider === "Jellyfin" && settings?.["metadataProvider"] === "tvdb" ? "tvdb" : "tmdb";
		const id = nestedString(
			payload,
			entitySchemaSlug === "show"
				? [
						`SeriesProvider_${metadataProvider}`,
						`SeriesProvider${metadataProvider.charAt(0).toUpperCase()}${metadataProvider.slice(1)}`,
						`Provider_${metadataProvider}`,
						metadataProvider === "tvdb" ? "Tvdb" : "Tmdb",
					]
				: [`Provider_${metadataProvider}`, metadataProvider === "tvdb" ? "Tvdb" : "Tmdb"],
		);
		if (!id) {
			return failureResult(
				`${provider} webhook payload is missing a ${metadataProvider.toUpperCase()} identifier`,
			);
		}
		const label =
			nestedString(
				payload,
				entitySchemaSlug === "show" ? ["SeriesName", "Name", "Title"] : ["Name", "Title"],
			) ?? id;
		const locator =
			entitySchemaSlug === "show"
				? showLocator(
						nestedNumber(payload, ["ParentIndexNumber", "SeasonNumber"]),
						nestedNumber(payload, ["IndexNumber", "EpisodeNumber"]),
					)
				: undefined;
		if (entitySchemaSlug === "show" && !locator) {
			return failureResult(`${provider} webhook payload is missing show episode coordinates`);
		}
		return progressResult({
			entityRef: resolvedRef(entitySchemaSlug, metadataProvider, id, label),
			progressPercent: percent,
			consumedOn: provider === "Jellyfin" ? "jellyfin_sink" : "emby",
			...(locator ? { episodeLocator: locator } : {}),
		});
	}).pipe(Effect.orElseSucceed(() => failureResult(`Could not parse ${provider} webhook payload`)));
