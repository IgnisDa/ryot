import { clockFormat } from "@ryot-app/plugin-ui-sdk";

export const maxDateMillis = 8.64e15;

export const toIso = (millis: number) => new Date(millis).toISOString();

export const isoAt = (millis: number) =>
	Number.isFinite(millis) && Math.abs(millis) <= maxDateMillis ? toIso(millis) : undefined;

export const formatEditorSeconds = (seconds: number) => {
	const whole = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(whole / 3600);
	return hours > 0
		? `${hours}:${clockFormat.format(whole % 3600).padStart(5, "0")}`
		: clockFormat.format(whole);
};

export const clockTime = (iso: string | undefined) =>
	iso === undefined
		? undefined
		: new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
