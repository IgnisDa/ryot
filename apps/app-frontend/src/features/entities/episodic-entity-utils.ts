type EpisodeLike = {
	name?: unknown;
	title?: unknown;
	number?: unknown;
	episodeNumber?: unknown;
};

type ShowSeasonLike = {
	name?: unknown;
	episodes?: unknown;
	seasonNumber?: unknown;
};

function normalizeEpisode(input: unknown) {
	if (!input || typeof input !== "object") {
		return null;
	}
	const value = input as EpisodeLike;
	const number = getOptionalInteger(value.episodeNumber ?? value.number);
	if (number === undefined) {
		return null;
	}
	const labelSource = typeof value.name === "string" ? value.name : value.title;
	return {
		number,
		label: typeof labelSource === "string" ? labelSource : `Episode ${number}`,
	};
}

export function getOptionalInteger(value: unknown) {
	return typeof value === "number" && Number.isInteger(value)
		? value
		: undefined;
}

export function getOptionalNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function getShowSeasons(properties?: Record<string, unknown>) {
	const seasons = Array.isArray(properties?.showSeasons)
		? properties.showSeasons
		: [];
	return seasons
		.map((season) => {
			if (!season || typeof season !== "object") {
				return null;
			}
			const value = season as ShowSeasonLike;
			const seasonNumber = getOptionalInteger(value.seasonNumber);
			if (seasonNumber === undefined) {
				return null;
			}
			const episodes = Array.isArray(value.episodes) ? value.episodes : [];
			return {
				seasonNumber,
				name:
					typeof value.name === "string"
						? value.name
						: `Season ${seasonNumber}`,
				episodes: episodes
					.map((episode) => normalizeEpisode(episode))
					.filter(
						(episode): episode is { number: number; label: string } =>
							episode !== null,
					),
			};
		})
		.filter(
			(
				season,
			): season is {
				name: string;
				seasonNumber: number;
				episodes: Array<{ number: number; label: string }>;
			} => season !== null,
		);
}

export function getPodcastEpisodes(properties?: Record<string, unknown>) {
	const episodes = Array.isArray(properties?.episodes)
		? properties.episodes
		: [];
	return episodes
		.map((episode) => normalizeEpisode(episode))
		.filter(
			(episode): episode is { number: number; label: string } =>
				episode !== null,
		);
}
