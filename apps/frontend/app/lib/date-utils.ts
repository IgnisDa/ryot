import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { match } from "ts-pattern";
import {
	ApplicationTimeRange,
	TimeSpan,
	type TimestampToStringResult,
} from "./types";

dayjs.extend(utc);
dayjs.extend(duration);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

export { dayjs as dayjsLib };

export const convertTimestampToUtcString = <
	T extends Date | string | null | undefined,
>(
	dateTime: T,
): TimestampToStringResult<T> => {
	if (!dateTime) return null as TimestampToStringResult<T>;

	const parsed = dayjs(dateTime);
	if (!parsed.isValid()) return null as TimestampToStringResult<T>;

	return parsed.utc().format() as TimestampToStringResult<T>;
};

export const getDateFromTimeSpan = (timeSpan: TimeSpan) =>
	match(timeSpan)
		.with(TimeSpan.Last7Days, () => dayjs().subtract(7, "days"))
		.with(TimeSpan.Last30Days, () => dayjs().subtract(30, "days"))
		.with(TimeSpan.Last90Days, () => dayjs().subtract(90, "days"))
		.with(TimeSpan.Last365Days, () => dayjs().subtract(365, "days"))
		.with(TimeSpan.AllTime, () => null)
		.exhaustive();

export const getTimeOfDay = (hours: number) => {
	if (hours >= 5 && hours < 12) return "Morning";
	if (hours >= 12 && hours < 17) return "Afternoon";
	if (hours >= 17 && hours < 21) return "Evening";
	return "Night";
};

export const convertUtcHourToLocalHour = (
	utcHour: number,
	userTimezone?: string,
) => {
	const targetTimezone = userTimezone || dayjs.tz.guess();
	const utcDate = dayjs.utc().hour(utcHour).minute(0).second(0);
	const localDate = utcDate.tz(targetTimezone);
	return localDate.hour();
};

export const getStartTimeFromRange = (range: ApplicationTimeRange) =>
	match(range)
		.with(ApplicationTimeRange.Yesterday, () => dayjs().subtract(1, "day"))
		.with(ApplicationTimeRange.ThisWeek, () => dayjs().startOf("week"))
		.with(ApplicationTimeRange.ThisMonth, () => dayjs().startOf("month"))
		.with(ApplicationTimeRange.ThisYear, () => dayjs().startOf("year"))
		.with(ApplicationTimeRange.Past7Days, () => dayjs().subtract(7, "day"))
		.with(ApplicationTimeRange.Past30Days, () => dayjs().subtract(30, "day"))
		.with(ApplicationTimeRange.Past6Months, () => dayjs().subtract(6, "month"))
		.with(ApplicationTimeRange.Past12Months, () =>
			dayjs().subtract(12, "month"),
		)
		.with(
			ApplicationTimeRange.AllTime,
			ApplicationTimeRange.Custom,
			() => undefined,
		)
		.exhaustive();
