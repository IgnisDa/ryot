import { parseWithZod } from "@conform-to/zod";
import dayjs, { type Dayjs } from "dayjs";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
	type HumanizeDurationOptions,
} from "humanize-duration-ts";
import camelCase from "lodash/camelCase";
import cloneDeep from "lodash/cloneDeep";
import groupBy from "lodash/groupBy";
import inRange from "lodash/inRange";
import isBoolean from "lodash/isBoolean";
import isEmpty from "lodash/isEmpty";
import isEqual from "lodash/isEqual";
import isInteger from "lodash/isInteger";
import isNumber from "lodash/isNumber";
import isString from "lodash/isString";
import mapValues from "lodash/mapValues";
import mergeWith from "lodash/mergeWith";
import omitBy from "lodash/omitBy";
import pickBy from "lodash/pickBy";
import set from "lodash/set";
import snakeCase from "lodash/snakeCase";
import sortBy from "lodash/sortBy";
import startCase from "lodash/startCase";
import sum from "lodash/sum";
import truncate from "lodash/truncate";
import invariant from "tiny-invariant";
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
export const formatDateToNaiveDate = (t: Date | Dayjs) =>
	dayjs(t).format("YYYY-MM-DD");

/**
 * Generate initials for a given string.
 */
export const getInitials = (name: string) => {
	const rgx = new RegExp(/(\p{L}{1})\p{L}+/gu);
	const initials = [...name.matchAll(rgx)];
	const actualValues = (
		(initials.shift()?.[1] || "") + (initials.pop()?.[1] || "")
	).toUpperCase();
	return actualValues;
};

/**
 * Change case to a presentable format.
 */
export const changeCase = (name: string) =>
	startCase(camelCase(name.toLowerCase()));

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

export const getActionIntent = (request: Request) => {
	const url = new URL(request.url);
	const intent = url.searchParams.get("intent");
	invariant(intent);
	return intent;
};

export {
	camelCase,
	cloneDeep,
	groupBy,
	inRange,
	isBoolean,
	isEmpty,
	isEqual,
	isInteger,
	isNumber,
	isString,
	mapValues,
	mergeWith,
	omitBy,
	pickBy,
	set,
	snakeCase,
	sortBy,
	startCase,
	sum,
	truncate,
};
