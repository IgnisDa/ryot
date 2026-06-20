import { Cron, Duration } from "effect";

export const DEFAULT_INFREQUENT_CRON = "0 0 * * *"; // midnight daily

const PHRASE_TO_CRON: Record<string, string> = {
	daily: DEFAULT_INFREQUENT_CRON,
	"every day": DEFAULT_INFREQUENT_CRON,
	"every night": DEFAULT_INFREQUENT_CRON,
	"every midnight": DEFAULT_INFREQUENT_CRON,
};

export const phraseToCronExpression = (value: string): string =>
	PHRASE_TO_CRON[value.trim().toLowerCase()] ?? value.trim();

export const parseInfrequentCron = (value: string, timezone: string) =>
	Cron.parse(phraseToCronExpression(value), timezone);

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
