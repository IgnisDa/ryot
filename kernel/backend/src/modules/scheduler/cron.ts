import { Duration } from "effect";

export const DEFAULT_FREQUENT_INTERVAL = Duration.minutes(5);

export const parseFrequentSchedule = (value: string | undefined): Duration.Duration | null => {
	if (!value) {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	if (normalized === "every minute") {
		return Duration.minutes(1);
	}
	if (normalized === "every hour") {
		return Duration.hours(1);
	}

	const match = normalized.match(/^every\s+(\d+)\s+(minute|minutes|hour|hours)$/);
	if (!match) {
		return null;
	}

	const amountText = match[1];
	const unit = match[2];
	if (!amountText || !unit) {
		return null;
	}

	const amount = Number.parseInt(amountText, 10);
	if (!Number.isFinite(amount) || amount <= 0) {
		return null;
	}

	return unit.startsWith("hour") ? Duration.hours(amount) : Duration.minutes(amount);
};
