import type { Tone } from "./model";

export const toneClasses: Readonly<Record<Tone, string>> = {
	up: "text-success",
	down: "text-danger",
	muted: "text-text-muted",
	record: "text-accent-text",
};
