import { type MessageFormatElement, SKELETON_TYPE, TYPE } from "@formatjs/icu-messageformat-parser";
import { DateTime, Option, Result } from "effect";
import IntlMessageFormat, { type Formatters as MessageFormatters } from "intl-messageformat";

import {
	type CatalogRegistry,
	type CompiledElement,
	type CompiledMessage,
	dateTimeArgumentKind,
	isZonedDateTimeStyle,
} from "./catalog";
import { dateTimeFormat, numberFormat, pluralRules } from "./formatters";
import { fallbackChain, SOURCE_LOCALE } from "./locale";
import {
	type DisplayText,
	isCalendarDate,
	isZonedDateTimeParam,
	loadingMessage,
	MAX_MESSAGE_NESTING_DEPTH,
	type Message,
	messageNamespaces,
	unavailableMessage,
} from "./message";
import { Text } from "./text";

const firstLocale = (locales: Intl.LocalesArgument) => {
	const [first] =
		locales === undefined || typeof locales === "string" ? [locales] : [locales].flat();
	return first === undefined ? SOURCE_LOCALE : String(first);
};

type MessageNumberFormatOptions = Parameters<MessageFormatters["getNumberFormat"]>[1];

/** Compiled skeletons only carry boolean grouping and ES2020 sign displays; see `NumberSkeletonOptions`. */
const intlNumberOptions = ({
	useGrouping,
	signDisplay,
	...options
}: NonNullable<MessageNumberFormatOptions>): Intl.NumberFormatOptions => ({
	...options,
	...(typeof useGrouping === "boolean" ? { useGrouping } : {}),
	...(signDisplay === undefined || signDisplay === "negative" ? {} : { signDisplay }),
});

/**
 * Plural categories follow the catalog the message resolved from, which may be a fallback locale;
 * numbers and dates format in the requested locale and, when given, the time zone. Calendar-date
 * and zoned date-time styles carry their own zone, which wins.
 */
const messageFormatters = (
	pluralLocale: string,
	timeZone: string | undefined,
): MessageFormatters => ({
	getPluralRules: (_locales, options) => pluralRules(pluralLocale, options),
	getNumberFormat: (locales, options) =>
		numberFormat(
			firstLocale(locales),
			options === undefined ? undefined : intlNumberOptions(options),
		),
	getDateTimeFormat: (locales, options) =>
		dateTimeFormat(
			firstLocale(locales),
			timeZone === undefined ? options : { timeZone, ...options },
		),
});

const options = (
	choices: { readonly [selector: string]: CompiledMessage },
	zones: ArgumentZones,
): Record<string, { value: MessageFormatElement[] }> =>
	Object.fromEntries(
		Object.entries(choices).map(([selector, option]) => [
			selector,
			{ value: toElements(option, zones) },
		]),
	);

const skeletonStyle = <Style extends object, Skeleton>(
	style: null | Style | string,
	skeleton: (options: Style) => Skeleton,
): null | string | Skeleton =>
	style === null || typeof style === "string" ? style : skeleton(style);

/** Zoned date-time arguments by name, with the zone their value carries. */
type ArgumentZones = ReadonlyMap<string, string>;

const toElement = (element: CompiledElement, zones: ArgumentZones): MessageFormatElement => {
	if (element.type === 0) {
		return { type: TYPE.literal, value: element.value };
	}
	if (element.type === 1) {
		return { type: TYPE.argument, value: element.value };
	}
	if (element.type === 7) {
		return { type: TYPE.pound };
	}
	if (element.type === 2) {
		return {
			type: TYPE.number,
			value: element.value,
			style: skeletonStyle(element.style, (parsedOptions) => ({
				tokens: [],
				type: SKELETON_TYPE.number,
				parsedOptions: { ...parsedOptions },
			})),
		};
	}
	if (element.type === 3 || element.type === 4) {
		const zone = isZonedDateTimeStyle(element.style) ? zones.get(element.value) : undefined;
		return {
			value: element.value,
			type: element.type === 3 ? TYPE.date : TYPE.time,
			style: skeletonStyle(element.style, (parsedOptions) => ({
				pattern: "",
				type: SKELETON_TYPE.dateTime,
				parsedOptions:
					zone === undefined ? { ...parsedOptions } : { ...parsedOptions, timeZone: zone },
			})),
		};
	}
	if (element.type === 5) {
		return { type: TYPE.select, value: element.value, options: options(element.options, zones) };
	}
	return {
		type: TYPE.plural,
		value: element.value,
		offset: element.offset,
		pluralType: element.pluralType,
		options: options(element.options, zones),
	};
};

const toElements = (message: CompiledMessage, zones: ArgumentZones): MessageFormatElement[] =>
	message.map((element) => toElement(element, zones));

export type PendingNamespaces = (namespace: string) => boolean;

export type FormatOptions = {
	/** IANA zone for date and time arguments, such as a recipient's; the runtime's zone otherwise. */
	readonly timeZone?: string | undefined;
	readonly isPending?: undefined | PendingNamespaces;
};

type DateTimeArgumentKind = ReturnType<typeof dateTimeArgumentKind>;

/** Arguments whose value is not a plain instant, by name. */
type ValueKinds = ReadonlyMap<string, Exclude<DateTimeArgumentKind, "date">>;

const valueKindsCache = new WeakMap<CompiledMessage, ValueKinds>();

const collectValueKinds = (
	message: CompiledMessage,
	kinds: Map<string, Exclude<DateTimeArgumentKind, "date">>,
) => {
	for (const element of message) {
		if (element.type === 3 || element.type === 4) {
			const kind = dateTimeArgumentKind(element);
			if (kind !== "date") {
				kinds.set(element.value, kind);
			}
		}
		if (element.type === 5 || element.type === 6) {
			for (const option of Object.values(element.options)) {
				collectValueKinds(option, kinds);
			}
		}
	}
	return kinds;
};

const valueKinds = (message: CompiledMessage) => {
	let kinds = valueKindsCache.get(message);
	if (kinds === undefined) {
		kinds = collectValueKinds(message, new Map());
		valueKindsCache.set(message, kinds);
	}
	return kinds;
};

const formatCache = new WeakMap<CompiledMessage, Map<string, IntlMessageFormat>>();

const messageFormat = (
	message: CompiledMessage,
	catalogLocale: string,
	locale: string,
	timeZone: string | undefined,
	zones: ArgumentZones,
) => {
	let byOptions = formatCache.get(message);
	if (byOptions === undefined) {
		byOptions = new Map();
		formatCache.set(message, byOptions);
	}
	const cacheKey = [
		locale,
		catalogLocale,
		timeZone ?? "",
		...[...zones].sort(([left], [right]) => (left < right ? -1 : 1)).flat(),
	].join("\u0000");
	let format = byOptions.get(cacheKey);
	if (format === undefined) {
		format = new IntlMessageFormat(toElements(message, zones), locale, undefined, {
			formatters: messageFormatters(catalogLocale, timeZone),
		});
		byOptions.set(cacheKey, format);
	}
	return format;
};

const resolve = (registry: CatalogRegistry, locale: string, message: Message) => {
	const catalogs = registry.get(message.namespace);
	if (catalogs === undefined) {
		return undefined;
	}
	for (const catalogLocale of fallbackChain(locale)) {
		const catalog = catalogs.get(catalogLocale);
		const compiled =
			catalog !== undefined && Object.hasOwn(catalog, message.key)
				? catalog[message.key]
				: undefined;
		if (compiled !== undefined) {
			return { compiled, catalogLocale };
		}
	}
	return undefined;
};

const renderParts = <Rich>(
	registry: CatalogRegistry,
	locale: string,
	message: Message,
	depth: number,
	rich: Readonly<Record<string, Rich>>,
	timeZone: string | undefined,
): undefined | ReadonlyArray<Rich | string> => {
	const resolved = resolve(registry, locale, message);
	if (resolved === undefined || depth > MAX_MESSAGE_NESTING_DEPTH) {
		return undefined;
	}
	const kinds = valueKinds(resolved.compiled);
	const zones = new Map<string, string>();
	const values: Record<string, Date | Rich | string | number> = {};
	for (const [name, value] of Object.entries(message.params ?? {})) {
		const kind = kinds.get(name);
		if (kind === "calendar-date") {
			if (typeof value !== "string" || !isCalendarDate(value)) {
				return undefined;
			}
			values[name] = new Date(`${value}T00:00:00.000Z`);
		} else if (kind === "zoned-date-time") {
			if (!isZonedDateTimeParam(value)) {
				return undefined;
			}
			const zone = DateTime.zoneMakeNamed(value.timeZone);
			if (Option.isNone(zone)) {
				return undefined;
			}
			zones.set(name, zone.value.id);
			values[name] = new Date(value.date);
		} else if (typeof value !== "object") {
			values[name] = value;
		} else if ("date" in value) {
			values[name] = new Date(value.date);
		} else {
			const nested = renderParts(registry, locale, value, depth + 1, {}, timeZone);
			if (nested === undefined) {
				return undefined;
			}
			values[name] = nested.join("");
		}
	}
	const format = messageFormat(resolved.compiled, resolved.catalogLocale, locale, timeZone, zones);
	const parts = Result.try(() => format.formatToParts<Rich>({ ...values, ...rich }));
	return Result.isFailure(parts) ? undefined : parts.success.map((part) => part.value);
};

const renderOrFallback = <Rich>(
	registry: CatalogRegistry,
	locale: string,
	message: Message,
	rich: Readonly<Record<string, Rich>>,
	{ timeZone, isPending }: FormatOptions,
) => {
	const rendered =
		renderParts(registry, locale, message, 0, rich, timeZone) ??
		renderParts(
			registry,
			locale,
			isPending !== undefined && [...messageNamespaces(message)].some(isPending)
				? loadingMessage
				: unavailableMessage,
			0,
			{},
			timeZone,
		);
	if (rendered === undefined) {
		throw new Error(`The ${unavailableMessage.namespace} catalog is not registered`);
	}
	return rendered;
};

/**
 * Renders through the fallback chain, then English. Messages whose namespace, key or parameters no
 * longer resolve render the kernel `message.unavailable` message instead, or `message.loading`
 * while `isPending` reports that a catalog they use is still loading.
 */
export const format = (
	registry: CatalogRegistry,
	locale: string,
	message: Message,
	formatOptions: FormatOptions = {},
): Text => Text(renderOrFallback(registry, locale, message, {}, formatOptions).join(""));

/**
 * Renders like `format`, with `rich` supplying argument values that are not text, such as UI
 * elements; the result keeps them as separate parts between the literal text.
 */
export const formatRich = <Rich>(
	registry: CatalogRegistry,
	locale: string,
	message: Message,
	rich: Readonly<Record<string, Rich>>,
	formatOptions: FormatOptions = {},
): ReadonlyArray<Text | Rich> =>
	renderOrFallback(registry, locale, message, rich, formatOptions).map((part) =>
		typeof part === "string" ? Text(part) : part,
	);

/** Model-facing boundaries render in the source locale, whatever the user's interface locale. */
export const formatForModel = (registry: CatalogRegistry, message: Message): Text =>
	format(registry, SOURCE_LOCALE, message);

/** User-authored text passes through unchanged; message references render through `t`. */
export const formatDisplayText = (t: (message: Message) => Text, text: DisplayText): Text =>
	typeof text === "string" ? Text(text) : t(text);
