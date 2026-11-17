import { Result, Schema } from "effect";

import {
	ARGUMENT_NAME_PATTERN,
	keysMatch,
	MAX_MESSAGE_ARGUMENTS,
	MESSAGE_KEY_PATTERN,
	MessageNamespace,
} from "./message";

export const CATALOG_LIMITS = {
	maxKeys: 5000,
	maxBranches: 16,
	maxNestingDepth: 3,
	maxMessageLength: 2000,
	maxFileBytes: 512 * 1024,
	maxDescriptionLength: 500,
	maxArguments: MAX_MESSAGE_ARGUMENTS,
} as const;

export const NAMED_NUMBER_STYLES = ["integer", "percent"] as const;
export const NAMED_DATE_TIME_STYLES = ["short", "medium", "long", "full"] as const;
export type NamedDateTimeStyle = (typeof NAMED_DATE_TIME_STYLES)[number];

/** The options `intl-messageformat` gives the named date styles. */
export const NAMED_DATE_STYLE_OPTIONS = {
	long: { month: "long", day: "numeric", year: "numeric" },
	medium: { day: "numeric", month: "short", year: "numeric" },
	short: { day: "numeric", year: "2-digit", month: "numeric" },
	full: { month: "long", day: "numeric", weekday: "long", year: "numeric" },
} as const;

/** The options `intl-messageformat` gives the named time styles. */
export const NAMED_TIME_STYLE_OPTIONS = {
	short: { hour: "numeric", minute: "numeric" },
	medium: { hour: "numeric", minute: "numeric", second: "numeric" },
	long: { hour: "numeric", minute: "numeric", second: "numeric", timeZoneName: "short" },
	full: { hour: "numeric", minute: "numeric", second: "numeric", timeZoneName: "short" },
} as const;

/**
 * The compiled `timeZone` of zoned date-time styles. It is not an IANA zone: rendering replaces it
 * with the zone the argument's value carries.
 */
export const ARGUMENT_TIME_ZONE = "argument";

const Digits = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const ShortLongNarrow = Schema.Literals(["long", "short", "narrow"]);
const NumericStyle = Schema.Literals(["numeric", "2-digit"]);

export const NumberSkeletonOptions = Schema.Struct({
	scale: Schema.optionalKey(Schema.Finite),
	useGrouping: Schema.optionalKey(Schema.Boolean),
	minimumIntegerDigits: Schema.optionalKey(Digits),
	maximumFractionDigits: Schema.optionalKey(Digits),
	minimumFractionDigits: Schema.optionalKey(Digits),
	numberingSystem: Schema.optionalKey(Schema.String),
	maximumSignificantDigits: Schema.optionalKey(Digits),
	minimumSignificantDigits: Schema.optionalKey(Digits),
	style: Schema.optionalKey(Schema.Literals(["decimal", "percent"])),
	compactDisplay: Schema.optionalKey(Schema.Literals(["short", "long"])),
	trailingZeroDisplay: Schema.optionalKey(Schema.Literals(["auto", "stripIfInteger"])),
	signDisplay: Schema.optionalKey(Schema.Literals(["auto", "always", "never", "exceptZero"])),
	roundingPriority: Schema.optionalKey(Schema.Literals(["auto", "morePrecision", "lessPrecision"])),
	notation: Schema.optionalKey(
		Schema.Literals(["standard", "scientific", "engineering", "compact"]),
	),
	roundingIncrement: Schema.optionalKey(
		Schema.Literals([1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]),
	),
	roundingMode: Schema.optionalKey(
		Schema.Literals([
			"ceil",
			"floor",
			"expand",
			"trunc",
			"halfCeil",
			"halfFloor",
			"halfEven",
			"halfTrunc",
			"halfExpand",
		]),
	),
});
export type NumberSkeletonOptions = typeof NumberSkeletonOptions.Type;

/**
 * An `hour` without `hourCycle` uses the locale's preferred hour cycle (skeleton `j`). Only
 * calendar-date styles (`UTC`) and zoned date-time styles (`ARGUMENT_TIME_ZONE`) set `timeZone`.
 */
export const DateTimeSkeletonOptions = Schema.Struct({
	day: Schema.optionalKey(NumericStyle),
	hour: Schema.optionalKey(NumericStyle),
	year: Schema.optionalKey(NumericStyle),
	era: Schema.optionalKey(ShortLongNarrow),
	minute: Schema.optionalKey(NumericStyle),
	second: Schema.optionalKey(NumericStyle),
	weekday: Schema.optionalKey(ShortLongNarrow),
	timeZoneName: Schema.optionalKey(Schema.Literals(["short", "long"])),
	timeZone: Schema.optionalKey(Schema.Literals(["UTC", ARGUMENT_TIME_ZONE])),
	hourCycle: Schema.optionalKey(Schema.Literals(["h11", "h12", "h23", "h24"])),
	month: Schema.optionalKey(Schema.Literals(["numeric", "2-digit", "long", "short", "narrow"])),
});
export type DateTimeSkeletonOptions = typeof DateTimeSkeletonOptions.Type;

const ArgumentName = Schema.String.check(Schema.isPattern(ARGUMENT_NAME_PATTERN));

const DateTimeStyle = Schema.Union([
	Schema.Null,
	Schema.Literals(NAMED_DATE_TIME_STYLES),
	DateTimeSkeletonOptions,
]);

/** A calendar-date argument compiles to a date style that formats in UTC. */
export const isCalendarDateStyle = (
	style: CompiledDateTimeStyle,
): style is DateTimeSkeletonOptions => typeof style === "object" && style?.timeZone === "UTC";

/** A zoned date-time argument compiles to date and time styles that format in the value's zone. */
export const isZonedDateTimeStyle = (
	style: CompiledDateTimeStyle,
): style is DateTimeSkeletonOptions =>
	typeof style === "object" && style?.timeZone === ARGUMENT_TIME_ZONE;

const hasTimeFields = (style: DateTimeSkeletonOptions) =>
	["hour", "minute", "second", "hourCycle", "timeZoneName"].some((field) =>
		Object.hasOwn(style, field),
	);

export type CompiledMessage = ReadonlyArray<CompiledElement>;

export type CompiledDateTimeStyle = null | NamedDateTimeStyle | DateTimeSkeletonOptions;

export type CompiledDateTimeElement = Extract<CompiledElement, { readonly type: 3 | 4 }>;

/** How a date or time element reads its value, which its style determines. */
export const dateTimeArgumentKind = (element: CompiledDateTimeElement) => {
	if (isZonedDateTimeStyle(element.style)) {
		return "zoned-date-time";
	}
	return element.type === 3 && isCalendarDateStyle(element.style) ? "calendar-date" : "date";
};

export type CompiledElement =
	| { readonly type: 7 }
	| { readonly type: 0; readonly value: string }
	| { readonly type: 1; readonly value: string }
	| { readonly type: 3; readonly value: string; readonly style: CompiledDateTimeStyle }
	| { readonly type: 4; readonly value: string; readonly style: CompiledDateTimeStyle }
	| {
			readonly type: 5;
			readonly value: string;
			readonly options: { readonly [selector: string]: CompiledMessage };
	  }
	| {
			readonly type: 2;
			readonly value: string;
			readonly style: null | NumberSkeletonOptions | (typeof NAMED_NUMBER_STYLES)[number];
	  }
	| {
			readonly type: 6;
			readonly value: string;
			readonly offset: number;
			readonly pluralType: "ordinal" | "cardinal";
			readonly options: { readonly [selector: string]: CompiledMessage };
	  };

export const CompiledMessage: Schema.Codec<CompiledMessage> = Schema.suspend(() =>
	Schema.Array(
		Schema.Union([
			Schema.Struct({ type: Schema.Literal(7) }),
			Schema.Struct({ value: Schema.String, type: Schema.Literal(0) }),
			Schema.Struct({ value: ArgumentName, type: Schema.Literal(1) }),
			Schema.Struct({
				value: ArgumentName,
				type: Schema.Literal(2),
				style: Schema.Union([
					Schema.Null,
					Schema.Literals(NAMED_NUMBER_STYLES),
					NumberSkeletonOptions,
				]),
			}),
			Schema.Struct({ value: ArgumentName, style: DateTimeStyle, type: Schema.Literal(3) }),
			Schema.Struct({ value: ArgumentName, style: DateTimeStyle, type: Schema.Literal(4) }),
			Schema.Struct({
				value: ArgumentName,
				type: Schema.Literal(5),
				options: Schema.Record(Schema.String, CompiledMessage),
			}),
			Schema.Struct({
				offset: Schema.Int,
				value: ArgumentName,
				type: Schema.Literal(6),
				pluralType: Schema.Literals(["cardinal", "ordinal"]),
				options: Schema.Record(Schema.String, CompiledMessage),
			}),
		]),
	),
).annotate({ identifier: "CompiledMessage" });

export const CompiledCatalog = Schema.Record(Schema.String, CompiledMessage).check(
	keysMatch(MESSAGE_KEY_PATTERN, "message keys"),
);
export type CompiledCatalog = typeof CompiledCatalog.Type;

export const NamespaceCatalog = Schema.Struct({
	catalog: CompiledCatalog,
	namespace: MessageNamespace,
});
export type NamespaceCatalog = typeof NamespaceCatalog.Type;

export const CatalogDiagnosticCode = Schema.Literals([
	"invalid-json",
	"invalid-locale",
	"invalid-key",
	"invalid-entry",
	"invalid-syntax",
	"markup",
	"unsupported-style",
	"invalid-selector",
	"file-too-large",
	"too-many-keys",
	"message-too-long",
	"description-too-long",
	"too-deeply-nested",
	"too-many-branches",
	"too-many-arguments",
	"missing-source-locale",
	"key-not-in-source",
	"argument-mismatch",
	"argument-conflict",
	"missing-translation",
	"unused-key",
	"unknown-key",
]);
export type CatalogDiagnosticCode = typeof CatalogDiagnosticCode.Type;

export const CatalogDiagnostic = Schema.Struct({
	detail: Schema.String,
	code: CatalogDiagnosticCode,
	key: Schema.optionalKey(Schema.String),
	file: Schema.optionalKey(Schema.String),
	severity: Schema.Literals(["error", "warning"]),
});
export type CatalogDiagnostic = typeof CatalogDiagnostic.Type;

export const formatCatalogDiagnostic = (diagnostic: CatalogDiagnostic) =>
	[diagnostic.file, diagnostic.key, `${diagnostic.severity} ${diagnostic.code}`, diagnostic.detail]
		.filter((part) => part !== undefined)
		.join(": ");

const PLURAL_SELECTOR = /^(?:zero|one|two|few|many|other|=\d+)$/;
const SELECT_SELECTOR = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const messageIssues = (
	message: CompiledMessage,
	depth: number,
	report: (code: CatalogDiagnosticCode, detail: string) => void,
	argumentNames: Set<string>,
) => {
	for (const element of message) {
		if (element.type === 7 || element.type === 0) {
			continue;
		}
		argumentNames.add(element.value);
		if (
			(element.type === 3 || element.type === 4) &&
			isCalendarDateStyle(element.style) &&
			(element.type === 4 || hasTimeFields(element.style))
		) {
			report(
				"unsupported-style",
				`Calendar-date argument "${element.value}" must be a date without time fields`,
			);
		}
		if (element.type !== 5 && element.type !== 6) {
			continue;
		}
		if (depth >= CATALOG_LIMITS.maxNestingDepth) {
			report(
				"too-deeply-nested",
				`Plural and select arguments nest deeper than ${CATALOG_LIMITS.maxNestingDepth} levels`,
			);
			return;
		}
		const selectors = Object.keys(element.options);
		if (selectors.length > CATALOG_LIMITS.maxBranches) {
			report(
				"too-many-branches",
				`Argument "${element.value}" has more than ${CATALOG_LIMITS.maxBranches} branches`,
			);
		}
		const pattern = element.type === 6 ? PLURAL_SELECTOR : SELECT_SELECTOR;
		for (const selector of selectors) {
			if (!pattern.test(selector)) {
				report(
					"invalid-selector",
					`Argument "${element.value}" has invalid selector "${selector}"`,
				);
			}
		}
		if (!selectors.includes("other")) {
			report("invalid-selector", `Argument "${element.value}" has no "other" branch`);
		}
		if (element.type === 5 && selectors.every((selector) => selector === "other")) {
			report("invalid-selector", `Select argument "${element.value}" has no codes besides "other"`);
		}
		for (const option of Object.values(element.options)) {
			messageIssues(option, depth + 1, report, argumentNames);
		}
	}
};

/** Limits shared by the build and by installation, which must not trust compiled archives. */
export const compiledCatalogIssues = (
	catalog: CompiledCatalog,
	file?: string,
): ReadonlyArray<CatalogDiagnostic> => {
	const diagnostics: CatalogDiagnostic[] = [];
	const base = file === undefined ? {} : { file };
	const keys = Object.keys(catalog);
	if (keys.length > CATALOG_LIMITS.maxKeys) {
		diagnostics.push({
			...base,
			severity: "error",
			code: "too-many-keys",
			detail: `Catalog has more than ${CATALOG_LIMITS.maxKeys} keys`,
		});
	}
	for (const [key, message] of Object.entries(catalog)) {
		const argumentNames = new Set<string>();
		messageIssues(
			message,
			0,
			(code, detail) => diagnostics.push({ ...base, key, code, detail, severity: "error" }),
			argumentNames,
		);
		if (argumentNames.size > CATALOG_LIMITS.maxArguments) {
			diagnostics.push({
				...base,
				key,
				severity: "error",
				code: "too-many-arguments",
				detail: `Message has more than ${CATALOG_LIMITS.maxArguments} arguments`,
			});
		}
	}
	return diagnostics;
};

const decodeCatalog = Schema.decodeUnknownResult(CompiledCatalog);

/** Decodes an untrusted compiled catalog and holds it to the structural catalog limits. */
export const decodeCompiledCatalog = (
	input: unknown,
	file?: string,
): Result.Result<CompiledCatalog, ReadonlyArray<string>> => {
	const decoded = decodeCatalog(input);
	if (Result.isFailure(decoded)) {
		return Result.fail([
			`${file === undefined ? "" : `${file}: `}Invalid compiled catalog: ${String(decoded.failure)}`,
		]);
	}
	const issues = compiledCatalogIssues(decoded.success, file).map(formatCatalogDiagnostic);
	return issues.length > 0 ? Result.fail(issues) : Result.succeed(decoded.success);
};

export type CatalogRegistry = ReadonlyMap<string, ReadonlyMap<string, CompiledCatalog>>;

export const emptyCatalogRegistry: CatalogRegistry = new Map();

export const registerCatalog = (
	registry: CatalogRegistry,
	namespace: string,
	locale: string,
	catalog: CompiledCatalog,
): CatalogRegistry => {
	const next = new Map(registry);
	next.set(namespace, new Map(registry.get(namespace)).set(locale, catalog));
	return next;
};

/** Registers each namespace's catalog for its locale on top of `registry`. */
export const catalogRegistry = (
	entries: Iterable<NamespaceCatalog & { readonly locale: string }>,
	registry = emptyCatalogRegistry,
) => {
	let next = registry;
	for (const { locale, catalog, namespace } of entries) {
		next = registerCatalog(next, namespace, locale, catalog);
	}
	return next;
};
