import { Option, Result, Schema } from "effect";

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

export const fallbackChain = (locale: string): ReadonlyArray<string> => {
	const canonical = canonicalLocale(locale);
	const chain = canonical === undefined ? [] : subtagChain(canonical);
	return chain.includes(SOURCE_LOCALE) ? chain : [...chain, SOURCE_LOCALE];
};

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

export const negotiateLocale = <const Available extends string>(
	requested: ReadonlyArray<string>,
	available: ReadonlyArray<Available>,
	fallback: NoInfer<Available>,
): Available => {
	const byCanonical = new Map(available.map((locale) => [canonicalLocale(locale), locale]));
	for (const tag of requested) {
		const canonical = canonicalLocale(tag);
		if (canonical === undefined) {
			continue;
		}
		const requestedLocale = new Intl.Locale(canonical).maximize();
		const matchesScript = (locale: string) =>
			new Intl.Locale(locale).maximize().script === requestedLocale.script;
		for (const candidate of subtagChain(canonical)) {
			const match = byCanonical.get(candidate);
			if (match !== undefined && matchesScript(match)) {
				return match;
			}
		}
		const compatible = available.filter(
			(locale) =>
				locale !== PSEUDO_LOCALE &&
				new Intl.Locale(locale).language === requestedLocale.language &&
				matchesScript(locale),
		);
		const regional =
			compatible.find(
				(locale) => new Intl.Locale(locale).maximize().region === requestedLocale.region,
			) ?? compatible[0];
		if (regional !== undefined) {
			return regional;
		}
	}
	return fallback;
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

const weekDays: ReadonlyArray<WeekDay> = [0, 1, 2, 3, 4, 5, 6];

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

const WeekInfo = Schema.Struct({
	firstDay: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 7 })),
});

const runtimeFirstDay = (locale: Intl.Locale) => {
	const getWeekInfo: unknown = Reflect.get(locale, "getWeekInfo");
	if (typeof getWeekInfo !== "function") {
		return Option.none();
	}
	const weekInfo: unknown = Reflect.apply(getWeekInfo, locale, []);
	return Option.map(Schema.decodeUnknownOption(WeekInfo)(weekInfo), ({ firstDay }) => firstDay % 7);
};

/** The CLDR `weekData.firstDay` table, read by the locale's likely region. */
export const cldrWeekStart = (locale: string): WeekDay =>
	cldrFirstDay.get(new Intl.Locale(locale).maximize().region ?? "") ?? 1;

/** Engines without `Intl.Locale#getWeekInfo`, such as some Firefox releases, use `cldrWeekStart`. */
export const weekStartForLocale = (locale: string): WeekDay =>
	Option.match(runtimeFirstDay(new Intl.Locale(locale)), {
		onNone: () => cldrWeekStart(locale),
		onSome: (firstDay) => weekDays[firstDay] ?? 1,
	});
