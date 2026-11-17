import { Schema } from "effect";

export const MAX_MESSAGE_KEY_LENGTH = 128;
export const MAX_MESSAGE_NESTING_DEPTH = 4;
export const MAX_MESSAGE_ARGUMENTS = 16;

const segment = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";

export const MESSAGE_KEY_PATTERN = new RegExp(`^${segment}(?:\\.${segment})+$`);

export const MessageKey = Schema.String.check(
	Schema.isMaxLength(MAX_MESSAGE_KEY_LENGTH),
	Schema.isPattern(MESSAGE_KEY_PATTERN),
);

/** `kernel` or a plugin ID; plugin IDs are generated alphanumeric identifiers. */
export const MessageNamespace = Schema.String.check(
	Schema.isMaxLength(MAX_MESSAGE_KEY_LENGTH),
	Schema.isPattern(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/),
);

export const ARGUMENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Record key schemas drop non-matching keys, so key syntax is checked on the whole record. */
export const keysMatch = (pattern: RegExp, description: string) =>
	Schema.makeFilter(
		(record: object) =>
			Object.keys(record).every((key) => pattern.test(key)) || `Keys must be ${description}`,
	);

export const DateParam = Schema.Struct({
	date: Schema.String.check(
		Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
		Schema.makeFilter((value) => Number.isFinite(Date.parse(value))),
	),
});
export type DateParam = typeof DateParam.Type;

/** An instant with the IANA time zone it renders in, for zoned date-time arguments. */
export const ZonedDateTimeParam = Schema.Struct({
	date: DateParam.fields.date,
	timeZone: Schema.String.check(
		Schema.isMaxLength(64),
		Schema.isPattern(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/),
	),
});
export type ZonedDateTimeParam = typeof ZonedDateTimeParam.Type;

export const isZonedDateTimeParam = Schema.is(ZonedDateTimeParam);

/** A day without a time of day, `YYYY-MM-DD`, for calendar-date arguments. */
export type CalendarDate = `${number}-${number}-${number}`;

export const isCalendarDate = (value: string): value is CalendarDate =>
	/^\d{4}-\d{2}-\d{2}$/.test(value) &&
	new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);

export const EntityReferenceParam = Schema.Struct({
	entityId: Schema.String.check(Schema.isMinLength(1)),
});
export type EntityReferenceParam = typeof EntityReferenceParam.Type;
export const isEntityReferenceParam = Schema.is(EntityReferenceParam);

export type MessageParam = Message | MessageValueParam;

export type LocalMessageParam = LocalMessage | MessageValueParam;

export type LocalMessage = {
	readonly key: string;
	readonly params?: { readonly [name: string]: LocalMessageParam };
};

export type Message = {
	readonly key: string;
	readonly namespace: string;
	readonly params?: { readonly [name: string]: MessageParam };
};

export const MessageValueParam = Schema.Union([
	Schema.String,
	Schema.Finite,
	ZonedDateTimeParam,
	DateParam,
	EntityReferenceParam,
]);
export type MessageValueParam = typeof MessageValueParam.Type;

const params = <Nested extends Schema.Top>(nested: Nested | undefined) =>
	Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Union([MessageValueParam, ...(nested === undefined ? [] : [nested])]),
		).check(
			keysMatch(ARGUMENT_NAME_PATTERN, "argument names"),
			Schema.isMaxProperties(MAX_MESSAGE_ARGUMENTS),
		),
	);

/** Nested message schemas end at the render depth, so decoding untrusted input never recurses deeper. */
const nestedMessage = (depth: number): Schema.Codec<Message> =>
	Schema.Struct({
		key: MessageKey,
		namespace: MessageNamespace,
		params: params(depth < MAX_MESSAGE_NESTING_DEPTH ? nestedMessage(depth + 1) : undefined),
	});

const nestedLocalMessage = (depth: number): Schema.Codec<LocalMessage> =>
	Schema.Struct({
		key: MessageKey,
		params: params(depth < MAX_MESSAGE_NESTING_DEPTH ? nestedLocalMessage(depth + 1) : undefined),
	});

/** A local message whose nested messages may already carry a namespace; see `stampTrustedNamespace`. */
export type TrustedLocalMessage = {
	readonly key: string;
	readonly params?: { readonly [name: string]: Message | MessageValueParam | TrustedLocalMessage };
};

const nestedTrustedLocalMessage = (depth: number): Schema.Codec<TrustedLocalMessage> =>
	Schema.Struct({
		key: MessageKey,
		params: params(
			depth < MAX_MESSAGE_NESTING_DEPTH
				? Schema.Union([nestedMessage(depth + 1), nestedTrustedLocalMessage(depth + 1)])
				: undefined,
		),
	});

/** Top-level structs, so constructors of schemas embedding a message accept only messages. */
export const Message = Schema.Struct({
	key: MessageKey,
	namespace: MessageNamespace,
	params: params(nestedMessage(1)),
}).annotate({ identifier: "Message" });

export const isMessage = Schema.is(Message);

export const LocalMessage = Schema.Struct({
	key: MessageKey,
	params: params(nestedLocalMessage(1)),
}).annotate({ identifier: "LocalMessage" });

export const TrustedLocalMessage = Schema.Struct({
	key: MessageKey,
	params: params(Schema.Union([nestedMessage(1), nestedTrustedLocalMessage(1)])),
}).annotate({ identifier: "TrustedLocalMessage" });

/** Text that is either a message reference or user-authored text, which is never translated. */
export const DisplayText = Schema.Union([Message, Schema.String]).annotate({
	identifier: "DisplayText",
});
export type DisplayText = string | Message;

export const KERNEL_NAMESPACE = "kernel";

export const unavailableMessage: Message = {
	key: "message.unavailable",
	namespace: KERNEL_NAMESPACE,
};

export const loadingMessage: Message = { key: "message.loading", namespace: KERNEL_NAMESPACE };

/** Whether a parameter value is a nested message rather than a string, number or date. */
export const isNestedMessage = <Nested extends { readonly key: string }>(
	value: Nested | MessageValueParam,
): value is Nested => typeof value === "object" && "key" in value;

/** The namespaces a message and its nested messages reference. */
export const messageNamespaces = (message: Message): ReadonlySet<string> =>
	new Set([
		message.namespace,
		...Object.values(message.params ?? {}).flatMap((value) =>
			isNestedMessage(value) ? Array.from(messageNamespaces(value)) : [],
		),
	]);

export const stampNamespace = (namespace: string, message: LocalMessage): Message => {
	if (message.params === undefined) {
		return { namespace, key: message.key };
	}
	const stamped: Record<string, MessageParam> = {};
	for (const [name, value] of Object.entries(message.params)) {
		stamped[name] = isNestedMessage(value) ? stampNamespace(namespace, value) : value;
	}
	return { namespace, params: stamped, key: message.key };
};

/**
 * Stamps like `stampNamespace`, but keeps nested messages that already carry a namespace, such as
 * a plugin's definition name inside a kernel notification. Only trusted producers may submit
 * them: plugin input decodes as `LocalMessage`, so a plugin cannot reference another catalog.
 */
export const stampTrustedNamespace = (namespace: string, message: TrustedLocalMessage): Message => {
	if (message.params === undefined) {
		return { namespace, key: message.key };
	}
	const stamped: Record<string, MessageParam> = {};
	for (const [name, value] of Object.entries(message.params)) {
		stamped[name] =
			isNestedMessage(value) && !("namespace" in value)
				? stampTrustedNamespace(namespace, value)
				: value;
	}
	return { namespace, params: stamped, key: message.key };
};
