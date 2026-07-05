import { dayjs } from "@ryot/ts-utils/dayjs";

export function hexToRgba(hex: string, alpha: number) {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function timeAgo(dateString: string) {
	const diff = dayjs().diff(dayjs(dateString), "minute");
	if (diff < 60) {
		return `${diff}m ago`;
	}
	const hours = Math.floor(diff / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const days = Math.floor(hours / 24);
	if (days < 7) {
		return `${days}d ago`;
	}
	return `${Math.floor(days / 7)}w ago`;
}

export function activityLabel(eventSchemaSlug: string, rating: number | null) {
	if (eventSchemaSlug === "progress") {
		return "Logged progress";
	}
	if (eventSchemaSlug === "backlog") {
		return "Added to queue";
	}
	if (eventSchemaSlug === "complete") {
		return "Completed";
	}
	if (eventSchemaSlug === "review") {
		return rating !== null ? `Rated ${rating}/10` : "Reviewed";
	}
	return "Updated";
}
