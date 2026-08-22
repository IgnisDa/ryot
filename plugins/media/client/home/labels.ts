import { DateTime } from "@ryot-app/client-sdk/effect";

import { formatLocalDateKey } from "../media/date";

const DAY_MS = 86_400_000;

const dayIndex = (day: string) =>
	Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;

const daysBetween = (from: string, to: string) => dayIndex(to) - dayIndex(from);

export const episodePositionLabel = (episode: {
	readonly episodeNumber: number;
	readonly seasonNumber: number | null;
}) =>
	episode.seasonNumber === null
		? `Ep ${episode.episodeNumber}`
		: `S${episode.seasonNumber} E${episode.episodeNumber}`;

export const flatProgressLabel = (item: {
	readonly schemaSlug: string;
	readonly mangaVolume: number | null;
	readonly animeEpisode: number | null;
	readonly mangaChapter: number | null;
	readonly progressPercent: number | null;
}) => {
	if (item.schemaSlug === "anime" && item.animeEpisode !== null) {
		return `Episode ${item.animeEpisode}`;
	}
	if (item.schemaSlug === "manga" && (item.mangaVolume !== null || item.mangaChapter !== null)) {
		return [
			item.mangaVolume === null ? undefined : `Vol ${item.mangaVolume}`,
			item.mangaChapter === null ? undefined : `Ch ${item.mangaChapter}`,
		]
			.filter((part) => part !== undefined)
			.join(", ");
	}
	return item.progressPercent === null ? undefined : `${Math.round(item.progressPercent)}%`;
};

const RELATIVE_UNITS = [
	{ days: 365, unit: "year" },
	{ days: 30, unit: "month" },
	{ days: 7, unit: "week" },
	{ days: 1, unit: "day" },
] as const;

const relativeFormat = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export const resumeLabel = (latestActivityAt: string | null, today: string) => {
	if (latestActivityAt === null) {
		return "Resume";
	}
	const days = Math.max(0, daysBetween(formatLocalDateKey(latestActivityAt), today));
	const { unit, days: size } = RELATIVE_UNITS.find((entry) => days >= entry.days) ?? {
		days: 1,
		unit: "day",
	};
	return `Resume · ${relativeFormat.format(-Math.floor(days / size), unit)}`;
};

const WEEK_DAYS = 7;

export const airingDayCaption = (day: string, today: string) => {
	const days = daysBetween(today, day);
	if (days === 0) {
		return "Today";
	}
	if (days === 1) {
		return "Tomorrow";
	}
	return DateTime.format(
		DateTime.makeUnsafe(day),
		days > 1 && days < WEEK_DAYS
			? { weekday: "long", locale: "en-US" }
			: { month: "short", day: "numeric", locale: "en-US" },
	);
};

export const sameDayLabel = (caption: string, sameDayCount: number) =>
	sameDayCount > 1 ? `${caption} · +${sameDayCount - 1} more` : caption;
