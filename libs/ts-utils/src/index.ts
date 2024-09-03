import { parseWithZod } from "@conform-to/zod";
import dayjs from "dayjs";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
	type HumanizeDurationOptions,
} from "humanize-duration-ts";
import camelCase from "lodash/camelCase";
import cloneDeep from "lodash/cloneDeep";
import groupBy from "lodash/groupBy";
import isBoolean from "lodash/isBoolean";
import isEmpty from "lodash/isEmpty";
import isEqual from "lodash/isEqual";
import isFinite from "lodash/isFinite";
import isNaN from "lodash/isNaN";
import isNumber from "lodash/isNumber";
import isString from "lodash/isString";
import mapValues from "lodash/mapValues";
import omitBy from "lodash/omitBy";
import pickBy from "lodash/pickBy";
import set from "lodash/set";
import snakeCase from "lodash/snakeCase";
import sortBy from "lodash/sortBy";
import startCase from "lodash/startCase";
import sum from "lodash/sum";
import truncate from "lodash/truncate";
import type { ZodTypeAny, output } from "zod";

/**
 * Humanize a duration.
 */
export const humanizeDuration = (
	duration: number,
	options?: HumanizeDurationOptions,
) => {
	const service = new HumanizeDurationLanguage();
	const humanizer = new HumanizeDuration(service);
	return humanizer.humanize(duration, options);
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
	const rgx = new RegExp(/(\p{L}{1})\p{L}+/gu);
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

export const processSubmission = <Schema extends ZodTypeAny>(
	formData: FormData,
	schema: Schema,
): output<Schema> => {
	const submission = parseWithZod(formData, { schema });
	if (submission.status !== "success")
		throw Response.json({ status: "idle", submission } as const);
	if (!submission.value)
		throw Response.json({ status: "error", submission } as const, {
			status: 400,
		});
	return submission.value;
};

export {
	camelCase,
	cloneDeep,
	groupBy,
	isBoolean,
	isEmpty,
	isEqual,
	isFinite,
	isNaN,
	isNumber,
	isString,
	mapValues,
	omitBy,
	pickBy,
	set,
	snakeCase,
	sortBy,
	startCase,
	sum,
	truncate,
};
