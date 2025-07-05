import { dayjsLib } from "~/lib/date-utils";
import { SECONDS_IN_MONTH } from "./constants";
import type { DurationInput } from "./types";

export const convertSecondsToDuration = (totalSeconds?: string | null) => {
	if (!totalSeconds) return {};
	const seconds = Number(totalSeconds);
	const mo = Math.floor(seconds / SECONDS_IN_MONTH);
	const remainingSeconds = seconds - mo * SECONDS_IN_MONTH;
	const remainingDuration = dayjsLib.duration(remainingSeconds, "seconds");
	const d = Math.floor(remainingDuration.asDays());
	const h = Math.floor(remainingDuration.subtract(d, "day").asHours());
	const min = Math.floor(
		remainingDuration.subtract(d, "day").subtract(h, "hour").asMinutes(),
	);
	return {
		d: d || undefined,
		h: h || undefined,
		mo: mo || undefined,
		min: min || undefined,
	};
};

export const convertDurationToSeconds = (duration: DurationInput) => {
	let total = 0;
	total += (duration.mo || 0) * SECONDS_IN_MONTH;
	total += dayjsLib.duration(duration.d || 0, "days").asSeconds();
	total += dayjsLib.duration(duration.h || 0, "hours").asSeconds();
	total += dayjsLib.duration(duration.min || 0, "minutes").asSeconds();
	return total;
};
