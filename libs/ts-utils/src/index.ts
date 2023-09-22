import TimeAgo from "javascript-time-ago";
import en from "javascript-time-ago/locale/en.json";
import {
	sum,
	camelCase,
	groupBy,
	mapValues,
	snakeCase,
	startCase,
} from "lodash";

TimeAgo.addDefaultLocale(en);

const timeAgo = new TimeAgo("en-US");

/**
 * Format a `Date` into a human readable format.
 */
export const formatTimeAgo = (time: Date) => {
	return timeAgo.format(time);
};

/**
 * Format a `Date` into a Rust `NaiveDate`
 */
export const formatDateToNaiveDate = (t: Date) => {
	return t.toISOString().split("T")[0];
};

/**
 * Generate initials for a given string.
 */
export const getInitials = (name: string) => {
	const rgx = new RegExp(/(\p{L}{1})\p{L}+/, "gu");
	const initials = [...name.matchAll(rgx)] || [];
	const actuals = (
		(initials.shift()?.[1] || "") + (initials.pop()?.[1] || "")
	).toUpperCase();
	return actuals;
};

/**
 * Change case to a presentable format.
 */
export const changeCase = (name: string) =>
	startCase(camelCase(name.toLowerCase()));

/**
 * Generate a random string of the given length.
 * Taken from: https://stackoverflow.com/a/1350278/11667450
 */
export const randomString = (length: number) => {
	let s = "";
	const randomChar = () => {
		const n = Math.floor(Math.random() * 62);
		if (n < 10) return n; //1-10
		if (n < 36) return String.fromCharCode(n + 55); //A-Z
		return String.fromCharCode(n + 61); //a-z
	};
	while (s.length < length) s += randomChar();
	return s;
};

export { sum, startCase, camelCase, snakeCase, groupBy, mapValues };
