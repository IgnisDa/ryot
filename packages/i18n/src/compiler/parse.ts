import {
	type DateElement,
	isArgumentElement,
	isDateElement,
	isDateTimeSkeleton,
	isLiteralElement,
	isNumberElement,
	isNumberSkeleton,
	isPoundElement,
	isSelectElement,
	isTagElement,
	isTimeElement,
	type MessageFormatElement,
	type NumberElement,
	parse,
	type PluralOrSelectOption,
	type TimeElement,
} from "@formatjs/icu-messageformat-parser";
import { Result, Schema } from "effect";

import {
	ARGUMENT_TIME_ZONE,
	type CatalogDiagnosticCode,
	type CompiledDateTimeStyle,
	type CompiledElement,
	type CompiledMessage,
	type DateTimeSkeletonOptions,
	NAMED_DATE_STYLE_OPTIONS,
	NAMED_DATE_TIME_STYLES,
	NAMED_NUMBER_STYLES,
	NAMED_TIME_STYLE_OPTIONS,
	type NamedDateTimeStyle,
	NumberSkeletonOptions,
} from "../catalog";
import { ARGUMENT_NAME_PATTERN } from "../message";

type CompiledNumberStyle = Extract<CompiledElement, { readonly type: 2 }>["style"];

type CompileIssue = { readonly detail: string; readonly code: CatalogDiagnosticCode };

const strict = { onExcessProperty: "error" } as const;
const decodeNumberOptions = Schema.decodeUnknownResult(NumberSkeletonOptions);
const numberStyles: ReadonlyArray<string> = NAMED_NUMBER_STYLES;
const dateTimeStyles: ReadonlyArray<string> = NAMED_DATE_TIME_STYLES;

const isNumberStyle = (style: string): style is (typeof NAMED_NUMBER_STYLES)[number] =>
	numberStyles.includes(style);
const isDateTimeStyle = (style: string): style is NamedDateTimeStyle =>
	dateTimeStyles.includes(style);

/** The named style of a `calendar-` or `zoned-` style. */
const prefixedStyle = (style: string, prefix: "zoned-" | "calendar-") => {
	const named = style.startsWith(prefix) ? style.slice(prefix.length) : undefined;
	return named !== undefined && isDateTimeStyle(named) ? named : undefined;
};

const numberStyle = (
	element: NumberElement,
	issues: CompileIssue[],
): undefined | CompiledNumberStyle => {
	const style = element.style ?? null;
	if (style === null || (typeof style === "string" && isNumberStyle(style))) {
		return style;
	}
	if (typeof style !== "string" && isNumberSkeleton(style)) {
		const options = decodeNumberOptions(style.parsedOptions, strict);
		if (Result.isSuccess(options)) {
			return options.success;
		}
	}
	issues.push({
		code: "unsupported-style",
		detail: `Number style of "${element.value}" must be ${numberStyles.join(", ")} or a supported skeleton`,
	});
	return undefined;
};

const NUMERIC_WIDTHS = ["numeric", "2-digit"] as const;
const TEXT_WIDTHS = ["short", "short", "short", "long", "narrow"] as const;
const MONTH_WIDTHS = ["numeric", "2-digit", "short", "long", "narrow"] as const;
const HOUR_CYCLES = { H: "h23", K: "h11", h: "h12", k: "h24" } as const;

const skeletonFieldOptions = (
	symbol: string,
	width: number,
): undefined | DateTimeSkeletonOptions => {
	const numeric = NUMERIC_WIDTHS.at(width - 1);
	const text = TEXT_WIDTHS.at(width - 1);
	switch (symbol) {
		case "G":
			return text === undefined ? undefined : { era: text };
		case "y":
			return numeric === undefined ? undefined : { year: numeric };
		case "M":
		case "L": {
			const month = MONTH_WIDTHS.at(width - 1);
			return month === undefined ? undefined : { month };
		}
		case "d":
			return numeric === undefined ? undefined : { day: numeric };
		case "E":
			return text === undefined ? undefined : { weekday: text };
		case "c":
		case "e":
			return width < 4 || text === undefined ? undefined : { weekday: text };
		case "j":
			return numeric === undefined ? undefined : { hour: numeric };
		case "H":
		case "K":
		case "h":
		case "k":
			return numeric === undefined ? undefined : { hour: numeric, hourCycle: HOUR_CYCLES[symbol] };
		case "m":
			return numeric === undefined ? undefined : { minute: numeric };
		case "s":
			return numeric === undefined ? undefined : { second: numeric };
		case "z":
			return width > 4 ? undefined : { timeZoneName: width === 4 ? "long" : "short" };
		default:
			return undefined;
	}
};

/**
 * Catalogs compile without a locale, so only fields that map to `Intl.DateTimeFormat` options
 * independently of the locale are accepted; `J`, `C` and day periods depend on it.
 */
const dateTimeSkeletonOptions = (skeleton: string) => {
	const options: DateTimeSkeletonOptions = {};
	for (const run of skeleton.match(/(.)\1*/gsu) ?? []) {
		const field = skeletonFieldOptions(run.charAt(0), run.length);
		if (field === undefined || Object.keys(field).some((name) => Object.hasOwn(options, name))) {
			return Result.fail(run);
		}
		Object.assign(options, field);
	}
	return Result.succeed(options);
};

const dateTimeStyle = (
	element: DateElement | TimeElement,
	issues: CompileIssue[],
): undefined | CompiledDateTimeStyle => {
	const style = element.style ?? null;
	if (style === null || (typeof style === "string" && isDateTimeStyle(style))) {
		return style;
	}
	const calendar = typeof style === "string" ? prefixedStyle(style, "calendar-") : undefined;
	if (calendar !== undefined) {
		if (isDateElement(element)) {
			return { ...NAMED_DATE_STYLE_OPTIONS[calendar], timeZone: "UTC" };
		}
		issues.push({
			code: "unsupported-style",
			detail: `Calendar-date style of "${element.value}" is allowed only on date arguments`,
		});
		return undefined;
	}
	const zoned = typeof style === "string" ? prefixedStyle(style, "zoned-") : undefined;
	if (zoned !== undefined) {
		const options = isDateElement(element) ? NAMED_DATE_STYLE_OPTIONS : NAMED_TIME_STYLE_OPTIONS;
		return { ...options[zoned], timeZone: ARGUMENT_TIME_ZONE };
	}
	if (typeof style !== "string" && isDateTimeSkeleton(style)) {
		const options = dateTimeSkeletonOptions(style.pattern);
		if (Result.isSuccess(options)) {
			return options.success;
		}
		issues.push({
			code: "unsupported-style",
			detail: `Date skeleton field "${options.failure}" of "${element.value}" is unsupported or repeated`,
		});
		return undefined;
	}
	issues.push({
		code: "unsupported-style",
		detail: `Date style of "${element.value}" must be ${dateTimeStyles.join(", ")}, one of them prefixed with "calendar-" or "zoned-", or a supported skeleton`,
	});
	return undefined;
};

const convertOptions = (
	options: Readonly<Record<string, PluralOrSelectOption>>,
	issues: CompileIssue[],
) =>
	Object.fromEntries(
		Object.entries(options).map(([selector, option]) => [selector, convert(option.value, issues)]),
	);

const convertElement = (
	element: MessageFormatElement,
	issues: CompileIssue[],
): undefined | CompiledElement => {
	if (isLiteralElement(element)) {
		return { type: 0, value: element.value };
	}
	if (isPoundElement(element)) {
		return { type: 7 };
	}
	if (isTagElement(element)) {
		issues.push({ code: "markup", detail: `Tag <${element.value}> is not allowed` });
		return undefined;
	}
	if (!ARGUMENT_NAME_PATTERN.test(element.value)) {
		issues.push({
			code: "invalid-syntax",
			detail: `Argument name "${element.value}" must match ${ARGUMENT_NAME_PATTERN.source}`,
		});
		return undefined;
	}
	if (isArgumentElement(element)) {
		return { type: 1, value: element.value };
	}
	if (isNumberElement(element)) {
		const style = numberStyle(element, issues);
		return style === undefined ? undefined : { style, type: 2, value: element.value };
	}
	if (isDateElement(element) || isTimeElement(element)) {
		const style = dateTimeStyle(element, issues);
		if (style === undefined) {
			return undefined;
		}
		return isDateElement(element)
			? { style, type: 3, value: element.value }
			: { style, type: 4, value: element.value };
	}
	if (isSelectElement(element)) {
		return { type: 5, value: element.value, options: convertOptions(element.options, issues) };
	}
	return {
		type: 6,
		value: element.value,
		offset: element.offset,
		pluralType: element.pluralType ?? "cardinal",
		options: convertOptions(element.options, issues),
	};
};

const convert = (
	elements: ReadonlyArray<MessageFormatElement>,
	issues: CompileIssue[],
): CompiledMessage => elements.flatMap((element) => convertElement(element, issues) ?? []);

export const compileMessage = (
	source: string,
): Result.Result<CompiledMessage, ReadonlyArray<CompileIssue>> => {
	const parsed = Result.try({
		try: () => parse(source, { ignoreTag: false, requiresOtherClause: true }),
		catch: (error) => (error instanceof Error ? error.message : String(error)),
	});
	if (Result.isFailure(parsed)) {
		return Result.fail([{ code: "invalid-syntax", detail: parsed.failure }]);
	}
	const issues: CompileIssue[] = [];
	const compiled = convert(parsed.success, issues);
	return issues.length === 0 ? Result.succeed(compiled) : Result.fail(issues);
};
