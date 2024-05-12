import { UserUnitSystem } from "@ryot/generated/graphql/backend/graphql";
import dayjs from "dayjs";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
	type HumanizeDurationOptions,
} from "humanize-duration-ts";
import camelCase from "lodash/camelCase";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import groupBy from "lodash/groupBy";
import isEmpty from "lodash/isEmpty";
import omitBy from "lodash/omitBy";
import set from "lodash/set";
import snakeCase from "lodash/snakeCase";
import startCase from "lodash/startCase";
import sum from "lodash/sum";

const service = new HumanizeDurationLanguage();
const humanizer = new HumanizeDuration(service);

/**
 * Humanize a duration.
 */
export const humanizeDuration = (
	duration: number,
	options?: HumanizeDurationOptions,
) => {
	return humanizer.humanize(duration, options);
};

/**
 * Display the correct weight unit for a given unit.
 */
export const displayWeightWithUnit = (
	unit: UserUnitSystem,
	data: string | number | null | undefined,
	compactNotation?: boolean,
) => {
	return new Intl.NumberFormat("en-us", {
		style: "unit",
		unit: unit === UserUnitSystem.Metric ? "kilogram" : "pound",
		notation: compactNotation ? "compact" : undefined,
	}).format(Number((data || 0).toString()));
};

/**
 * Display the correct distance unit for a given unit.
 */
export const displayDistanceWithUnit = (
	unit: UserUnitSystem,
	data: string | number | null | undefined,
) => {
	return new Intl.NumberFormat("en-us", {
		style: "unit",
		unit: unit === UserUnitSystem.Metric ? "kilometer" : "mile",
	}).format(Number((data || 0).toString()));
};

/**
 * Format a `Date` into a Rust `NaiveDate`
 */
export const formatDateToNaiveDate = (t: Date) => {
	return dayjs(t).format("YYYY-MM-DD");
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

export {
	cloneDeep,
	camelCase,
	groupBy,
	isEqual,
	omitBy,
	isEmpty,
	set,
	snakeCase,
	startCase,
	sum,
};
