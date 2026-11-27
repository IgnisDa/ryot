import type {
	CalendarDate,
	EntityReferenceParam,
	LocalMessage,
	Message,
	MessageValueParam,
} from "./message";
import type { Text } from "./text";

export interface TextArgument {
	readonly kind: "text";
}

export interface DateArgument {
	readonly kind: "date";
}

export interface NumberArgument {
	readonly kind: "number";
}

export type NoArguments = { readonly [argument in never]: never };

/** A day without a time of day, passed as `YYYY-MM-DD` and rendered in UTC. */
export interface CalendarDateArgument {
	readonly kind: "calendar-date";
}

/** An instant rendered in its own IANA time zone, passed as a `ZonedDateTime`. */
export interface ZonedDateTimeArgument {
	readonly kind: "zoned-date-time";
}

/** The value of a zoned date-time argument. */
export type ZonedDateTime = { readonly date: Date; readonly timeZone: string };

/** Each argument of a message bound by name to the source of its value, such as a row field. */
export type ArgumentBindings<Arguments> = { readonly [Name in keyof Arguments]: string };

export type CatalogShape = {
	readonly [key: string]: { readonly [argument: string]: ArgumentSpec };
};

export interface SelectArgument<Code extends string> {
	readonly codes: Code;
	readonly kind: "select";
}

/** Builds messages of one namespace's catalog; `namespace` lets renderers address the same catalog. */
export type MessageBuilder<Catalog extends CatalogShape> = BuildMessage<Catalog> & {
	readonly namespace: string;
};

export type MessageArguments<Arguments, Nested> = {
	readonly [Name in keyof Arguments]: ArgumentValue<Arguments[Name], Nested>;
};

export type MessageParams<Arguments, Nested> = keyof Arguments extends never
	? []
	: [params: MessageArguments<Arguments, Nested>];

export type ArgumentSpec =
	| TextArgument
	| DateArgument
	| NumberArgument
	| CalendarDateArgument
	| ZonedDateTimeArgument
	| SelectArgument<string>;

/** A local builder whose result is already rendered, as returned by client message hooks. */
export type LocalTextBuilder<Catalog extends CatalogShape> = <
	const Key extends string & keyof Catalog,
>(
	key: Key,
	...params: MessageParams<Catalog[Key], LocalMessage>
) => Text;

export type LocalMessageBuilder<Catalog extends CatalogShape> = <
	const Key extends string & keyof Catalog,
>(
	key: Key,
	...params: MessageParams<Catalog[Key], LocalMessage>
) => LocalMessage;

/** The codes a catalog key accepts for one of its select arguments. */
export type SelectCodes<
	Catalog extends CatalogShape,
	Key extends keyof Catalog,
	Argument extends keyof Catalog[Key],
> = Catalog[Key][Argument] extends SelectArgument<infer Code> ? Code : never;

/**
 * Builds a key whose argument values are bound later, per value source: `params` names the
 * source of every argument the message declares.
 */
export type LocalBindingBuilder<Catalog extends CatalogShape> = <
	const Key extends string & keyof Catalog,
>(
	key: Key,
	params: ArgumentBindings<Catalog[Key]>,
) => { readonly text: { readonly key: Key }; readonly params: ArgumentBindings<Catalog[Key]> };

type EncodedParam<Nested> = Nested | MessageValueParam;

type BuildMessage<Catalog extends CatalogShape> = <const Key extends string & keyof Catalog>(
	key: Key,
	...params: MessageParams<Catalog[Key], Message>
) => Message;

type ArgumentValue<Spec, Nested> = Spec extends TextArgument
	? string | Nested | EntityReferenceParam
	: Spec extends NumberArgument
		? number
		: Spec extends DateArgument
			? Date
			: Spec extends CalendarDateArgument
				? CalendarDate
				: Spec extends ZonedDateTimeArgument
					? ZonedDateTime
					: Spec extends SelectArgument<infer Code>
						? Code
						: never;

const isZonedDateTime = (value: object): value is ZonedDateTime =>
	"timeZone" in value && "date" in value && value.date instanceof Date;

export const encodeParam = <Nested extends object>(
	value: Date | string | number | Nested | ZonedDateTime | EntityReferenceParam,
): EncodedParam<Nested> => {
	if (value instanceof Date) {
		return { date: value.toISOString() };
	}
	if (typeof value === "object" && isZonedDateTime(value)) {
		return { timeZone: value.timeZone, date: value.date.toISOString() };
	}
	return value;
};

const encodeParams = <Nested extends object>(
	params: ReadonlyArray<
		Readonly<Record<string, Date | string | number | Nested | ZonedDateTime | EntityReferenceParam>>
	>,
) => {
	const [values] = params;
	if (values === undefined) {
		return undefined;
	}
	const encoded: Record<string, EncodedParam<Nested>> = {};
	for (const [name, value] of Object.entries(values)) {
		encoded[name] = encodeParam(value);
	}
	return encoded;
};

export const localMessageBuilder =
	<Catalog extends CatalogShape>(): LocalMessageBuilder<Catalog> =>
	(key, ...params) => {
		const encoded = encodeParams<LocalMessage>(params);
		return encoded === undefined ? { key } : { key, params: encoded };
	};

export const localBindingBuilder =
	<Catalog extends CatalogShape>(): LocalBindingBuilder<Catalog> =>
	(key, params) => ({ params, text: { key } });

export const messageBuilder = <Catalog extends CatalogShape>(
	namespace: string,
): MessageBuilder<Catalog> => {
	const build: BuildMessage<Catalog> = (key, ...params) => {
		const encoded = encodeParams<Message>(params);
		return encoded === undefined ? { key, namespace } : { key, namespace, params: encoded };
	};
	return Object.assign(build, { namespace });
};
