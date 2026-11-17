type OptionValue = string | number | boolean | undefined | ReadonlyArray<string>;

const optionsKey = (locale: string, options: object | undefined) =>
	[
		locale,
		...Object.entries(options ?? {})
			.filter((entry): entry is [string, OptionValue] => entry[1] !== undefined)
			.map(([name, value]) => `${name}=${String(value)}`)
			.sort((left, right) => (left < right ? -1 : 1)),
	].join("\u0000");

const cached = <Options extends object, Formatter>(
	create: (locale: string, options: Options | undefined) => Formatter,
) => {
	const cache = new Map<string, Formatter>();
	return (locale: string, options?: Options): Formatter => {
		const key = optionsKey(locale, options);
		let formatter = cache.get(key);
		if (formatter === undefined) {
			formatter = create(locale, options);
			cache.set(key, formatter);
		}
		return formatter;
	};
};

export const numberFormat = cached(
	(locale, options: undefined | Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options),
);

export const dateTimeFormat = cached(
	(locale, options: undefined | Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(locale, options),
);

export const relativeTimeFormat = cached(
	(locale, options: undefined | Intl.RelativeTimeFormatOptions) =>
		new Intl.RelativeTimeFormat(locale, options),
);

export const listFormat = cached(
	(locale, options: undefined | Intl.ListFormatOptions) => new Intl.ListFormat(locale, options),
);

export const pluralRules = cached(
	(locale, options: undefined | Intl.PluralRulesOptions) => new Intl.PluralRules(locale, options),
);

export const displayNames = cached(
	(locale, options: undefined | Intl.DisplayNamesOptions) =>
		new Intl.DisplayNames(locale, options ?? { type: "language" }),
);

/** Uncached so a device time zone change is seen; cached formatters keep the zone they were created in. */
export const systemTimeZone = () => new Intl.DateTimeFormat().resolvedOptions().timeZone;

export type Formatters = {
	readonly list: (options?: Intl.ListFormatOptions) => Intl.ListFormat;
	readonly plural: (options?: Intl.PluralRulesOptions) => Intl.PluralRules;
	readonly number: (options?: Intl.NumberFormatOptions) => Intl.NumberFormat;
	readonly displayNames: (options: Intl.DisplayNamesOptions) => Intl.DisplayNames;
	readonly dateTime: (options?: Intl.DateTimeFormatOptions) => Intl.DateTimeFormat;
	readonly relativeTime: (options?: Intl.RelativeTimeFormatOptions) => Intl.RelativeTimeFormat;
};

const formattersByLocale = new Map<string, Formatters>();

export const formattersFor = (locale: string): Formatters => {
	let formatters = formattersByLocale.get(locale);
	if (formatters === undefined) {
		formatters = {
			list: (options) => listFormat(locale, options),
			plural: (options) => pluralRules(locale, options),
			number: (options) => numberFormat(locale, options),
			dateTime: (options) => dateTimeFormat(locale, options),
			displayNames: (options) => displayNames(locale, options),
			relativeTime: (options) => relativeTimeFormat(locale, options),
		};
		formattersByLocale.set(locale, formatters);
	}
	return formatters;
};
