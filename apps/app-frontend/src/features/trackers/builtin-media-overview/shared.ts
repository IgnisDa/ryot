import { type Dayjs, dayjs } from "@ryot/ts-utils";

import type { ApiGetResponseData } from "~/lib/api/types";

export const GOLD = "#C9943A";
export const STONE = "#8C7560";

export const SECTION_ACCENTS = {
	library: STONE,
	continue: GOLD,
	queue: "#8E6A4D",
	review: "#D38D5A",
	activity: "#6F8B75",
};

export function colorMix(color: string, alpha: number) {
	return `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`;
}

export function getQueueNote(slug: string, backlogAt: Dayjs, rank: number) {
	if (rank === 0) {
		return "Pick tonight";
	}
	const daysSinceBacklog = dayjs().diff(backlogAt, "day", true);
	if (daysSinceBacklog < 7) {
		return "Freshly queued";
	}
	if (slug === "anime") {
		return "Easy to resume";
	}
	if (slug === "book" || slug === "manga") {
		return "Settle in with this";
	}
	return "Waiting in the wings";
}

export function getSectionBackground(props: { accent: string; isDark: boolean; surface: string }) {
	if (props.isDark) {
		return `linear-gradient(180deg, ${colorMix(props.accent, 0.18)} 0%, ${props.surface} 22%, ${props.surface} 100%)`;
	}
	return `linear-gradient(180deg, ${colorMix(props.accent, 0.08)} 0%, ${colorMix(props.accent, 0.03)} 18%, ${props.surface} 40%, ${props.surface} 100%)`;
}

export type OverviewUpNextItem = ApiGetResponseData<"/media/overview/up-next">["items"][number];
export type OverviewContinueItem = ApiGetResponseData<"/media/overview/continue">["items"][number];
export type OverviewRateTheseItem = ApiGetResponseData<"/media/overview/review">["items"][number];
export type OverviewActivityItem = ApiGetResponseData<"/media/overview/activity">["items"][number];
export type OverviewWeekItem = ApiGetResponseData<"/media/overview/week">["items"][number];

export interface ActivityEventView {
	id: string;
	sub?: string;
	date: string;
	time: string;
	title: string;
	action: string;
	entityId: string;
	imageUrl?: string;
	rating: number | null;
	entitySchemaSlug: string;
}

export interface WeekDayView {
	day: string;
	count: number;
}

export function getActivityDateLabel(date: Dayjs) {
	const now = dayjs();
	if (date.isSame(now, "day")) {
		return "Today";
	}
	if (date.isSame(now.subtract(1, "day"), "day")) {
		return "Yesterday";
	}

	return date.format(date.year() === now.year() ? "MMM D" : "MMM D, YYYY");
}

export function getActivityActionLabel(item: OverviewActivityItem) {
	if (item.eventSchemaSlug === "progress") {
		return item.entity.entitySchemaSlug === "anime" ? "Watched" : "Logged progress";
	}
	if (item.eventSchemaSlug === "backlog") {
		return "Queued";
	}
	if (item.eventSchemaSlug === "review") {
		return "Rated";
	}
	return "Completed";
}

export function buildWeekActivity(days: OverviewWeekItem[]): WeekDayView[] {
	return days.map((day) => ({ day: day.dayLabel, count: day.count }));
}

export function getLastActivityLabel(date: Date) {
	const now = dayjs();
	const d = dayjs(date);
	const diffDays = now.diff(d, "day");
	const diffHours = now.diff(d, "hour");
	const diffMinutes = now.diff(d, "minute");

	if (diffMinutes < 1) {
		return "Just now";
	}
	if (diffMinutes < 60) {
		return `${diffMinutes}m ago`;
	}
	if (diffHours < 24) {
		return `${diffHours}h ago`;
	}
	if (diffDays < 7) {
		return `${diffDays}d ago`;
	}

	return d.format("MMM D");
}
