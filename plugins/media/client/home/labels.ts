import { calendarDaysBetween } from "@ryot-app/plugin-client-sdk/plugin";
import type { Formatters } from "@ryot-app/plugin-client-sdk/react";
import { formatDaysAgo } from "@ryot-app/plugin-ui-sdk/datetime";

import type { MediaPosition } from "../../shared/consumption";
import { mediaPositionLabel } from "../media/activity-copy";
import { formatLocalDateKey } from "../media/date";
import type { MediaText } from "../messages";

export const episodePositionLabel = (
	text: MediaText,
	episode: { readonly episodeNumber: number; readonly seasonNumber: null | number },
) =>
	episode.seasonNumber === null
		? text("home.episode-position", { episode: episode.episodeNumber })
		: text("home.episode-position-seasonal", {
				season: episode.seasonNumber,
				episode: episode.episodeNumber,
			});

export const flatProgressLabel = (
	text: MediaText,
	formatters: Formatters,
	item: { readonly position: null | MediaPosition; readonly progressPercent: null | number },
) => {
	if (item.position !== null) {
		return mediaPositionLabel(text, item.position);
	}
	return item.progressPercent === null
		? undefined
		: formatters.number({ style: "percent" }).format(Math.round(item.progressPercent) / 100);
};

export const resumeLabel = (
	text: MediaText,
	formatters: Formatters,
	latestActivityAt: null | string,
	today: string,
) => {
	if (latestActivityAt === null) {
		return text("home.resume");
	}
	return text("home.resume-since", {
		when: formatDaysAgo(
			formatters,
			calendarDaysBetween(formatLocalDateKey(latestActivityAt), today),
		),
	});
};

const WEEK_DAYS = 7;

export const airingDayCaption = (
	text: MediaText,
	formatters: Formatters,
	day: string,
	today: string,
) => {
	const days = calendarDaysBetween(today, day);
	if (days === 0) {
		return text("home.today");
	}
	if (days === 1) {
		return text("home.tomorrow");
	}
	return formatters
		.dateTime(
			days > 1 && days < WEEK_DAYS
				? { weekday: "long", timeZone: "UTC" }
				: { month: "short", day: "numeric", timeZone: "UTC" },
		)
		.format(Date.parse(day));
};

export const moreLabel = (text: MediaText, caption: string, more: number) =>
	more > 0 ? text("home.more-caption", { caption, count: more }) : caption;
