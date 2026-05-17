import {
	HumanizeDuration,
	HumanizeDurationLanguage,
	type HumanizeDurationOptions,
} from "humanize-duration-ts";

import { type Dayjs, dayjs } from "./dayjs";

/**
 * Humanize a duration.
 */
export const humanizeDuration = (duration: number, options?: HumanizeDurationOptions) => {
	const service = new HumanizeDurationLanguage();
	const humanizer = new HumanizeDuration(service);
	return humanizer.humanize(duration, options);
};

export const formatQuantityWithCompactNotation = (value: number) =>
	new Intl.NumberFormat("en-US", {
		notation: "compact",
	}).format(value);

/**
 * Format a `Date` into a Rust `NaiveDate`
 */
export const formatDateToNaiveDate = (t: Date | Dayjs) => dayjs(t).format("YYYY-MM-DD");
