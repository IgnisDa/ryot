import { Result, Schema } from "effect";

export const SOURCE_LOCALE = "en";
export const PSEUDO_LOCALE = "en-XA";

export const canonicalLocale = (tag: string): string | undefined => {
	const canonical = Result.try(() => Intl.getCanonicalLocales(tag));
	return Result.isSuccess(canonical) ? canonical.success[0] : undefined;
};

export const LocaleTag = Schema.String.check(
	Schema.makeFilter(
		(value) => canonicalLocale(value) === value || "Expected a canonical BCP 47 tag",
	),
);

const subtagChain = (canonical: string) => {
	const subtags = new Intl.Locale(canonical).baseName.split("-");
	return subtags.map((_, index) => subtags.slice(0, subtags.length - index).join("-"));
};

const sameScript = (left: string, right: string) =>
	new Intl.Locale(left).maximize().script === new Intl.Locale(right).maximize().script;

export const parseAcceptLanguage = (header: string): ReadonlyArray<string> =>
	header
		.split(",")
		.map((part, index) => {
			const [tag = "", ...parameters] = part.trim().split(";");
			const quality = parameters
				.map((parameter) => parameter.trim().match(/^q=([01](?:\.\d{0,3})?)$/)?.[1])
				.find((value) => value !== undefined);
			return { index, tag: tag.trim(), quality: quality === undefined ? 1 : Number(quality) };
		})
		.filter((entry) => entry.tag !== "" && entry.tag !== "*" && entry.quality > 0)
		.sort((left, right) => right.quality - left.quality || left.index - right.index)
		.map((entry) => entry.tag);

const matchCatalog = (locale: string, available: ReadonlyArray<string>) => {
	for (const candidate of subtagChain(locale)) {
		const match = available.find((entry) => entry === candidate);
		if (match !== undefined && sameScript(match, locale)) {
			return match;
		}
	}
	const requested = new Intl.Locale(locale).maximize();
	const compatible = available.filter(
		(candidate) =>
			candidate !== PSEUDO_LOCALE &&
			new Intl.Locale(candidate).language === requested.language &&
			sameScript(candidate, locale),
	);
	return (
		compatible.find(
			(candidate) => new Intl.Locale(candidate).maximize().region === requested.region,
		) ?? compatible[0]
	);
};

export const preferredLocale = (
	requested: Iterable<string>,
	catalogs: ReadonlyArray<string>,
): string => {
	let first: string | undefined;
	for (const tag of requested) {
		const locale = canonicalLocale(tag);
		if (locale !== undefined) {
			first ??= locale;
			if (matchCatalog(locale, catalogs) !== undefined) {
				return locale;
			}
		}
	}
	return first ?? SOURCE_LOCALE;
};

export const fallbackChain = (
	locale: string,
	catalogs: Iterable<string> = [],
): ReadonlyArray<string> => {
	const canonical = canonicalLocale(locale);
	if (canonical === undefined) {
		return [SOURCE_LOCALE];
	}
	const chain = subtagChain(canonical).filter((candidate) => sameScript(candidate, canonical));
	const match = matchCatalog(canonical, [...catalogs]);
	return [...new Set([...chain, ...(match === undefined ? [] : [match]), SOURCE_LOCALE])];
};

export const TextDirection = Schema.Literals(["ltr", "rtl"]);
export type TextDirection = typeof TextDirection.Type;

const rightToLeftScripts = new Set([
	"Adlm",
	"Arab",
	"Hebr",
	"Mand",
	"Mend",
	"Nkoo",
	"Rohg",
	"Samr",
	"Syrc",
	"Thaa",
	"Yezi",
]);

export const textDirection = (locale: string): TextDirection =>
	rightToLeftScripts.has(new Intl.Locale(locale).maximize().script ?? "") ? "rtl" : "ltr";

export const languageOfLocale = (locale: string) => new Intl.Locale(locale).language;

export const WeekDay = Schema.Literals([0, 1, 2, 3, 4, 5, 6]);
export type WeekDay = typeof WeekDay.Type;

const cldrFirstDay = new Map<string, WeekDay>([
	...["MV"].map((region) => [region, 5] as const),
	...["AE", "AF", "BH", "DJ", "DZ", "EG", "IQ", "IR", "JO", "KW", "LY", "OM", "QA", "SD", "SY"].map(
		(region) => [region, 6] as const,
	),
	...[
		"AG",
		"AS",
		"BD",
		"BR",
		"BS",
		"BT",
		"BW",
		"BZ",
		"CA",
		"CN",
		"CO",
		"DM",
		"DO",
		"ET",
		"GT",
		"GU",
		"HK",
		"HN",
		"ID",
		"IL",
		"IN",
		"JM",
		"JP",
		"KE",
		"KH",
		"KR",
		"LA",
		"MH",
		"MM",
		"MO",
		"MT",
		"MX",
		"MZ",
		"NI",
		"NP",
		"PA",
		"PE",
		"PH",
		"PK",
		"PR",
		"PT",
		"PY",
		"SA",
		"SG",
		"SV",
		"TH",
		"TT",
		"TW",
		"UM",
		"US",
		"VE",
		"VI",
		"WS",
		"YE",
		"ZA",
		"ZW",
	].map((region) => [region, 0] as const),
]);

/** A fixed CLDR table keeps week boundaries consistent across browser and server ICU versions. */
export const weekStartForLocale = (locale: string): WeekDay =>
	cldrFirstDay.get(new Intl.Locale(locale).maximize().region ?? "") ?? 1;
