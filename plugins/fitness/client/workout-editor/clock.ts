import type { Formatters } from "@ryot-app/plugin-client-sdk/react";

export const maxDateMillis = 8.64e15;

export const toIso = (millis: number) => new Date(millis).toISOString();

export const isoAt = (millis: number) =>
	Number.isFinite(millis) && Math.abs(millis) <= maxDateMillis ? toIso(millis) : undefined;

export const clockTime = (formatters: Formatters, iso: string | undefined) =>
	iso === undefined
		? undefined
		: formatters.dateTime({ hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
