import {
	createContext,
	Fragment,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";

import {
	type CatalogShape,
	encodeParam,
	type MessageBuilder,
	type MessageParams,
	type ZonedDateTime,
} from "./builder";
import type { CatalogRegistry } from "./catalog";
import { format, formatRich, type PendingNamespaces } from "./format";
import { type Formatters, formattersFor } from "./formatters";
import { type TextDirection, textDirection } from "./locale";
import type { EntityReferenceParam, Message, MessageParam } from "./message";
import type { Text } from "./text";

type RichPart = { readonly name: string; readonly element: ReactElement };

type I18nValue = {
	readonly locale: string;
	readonly formatters: Formatters;
	readonly direction: TextDirection;
	readonly t: (message: Message) => Text;
	readonly rich: (
		message: Message,
		parts: Readonly<Record<string, RichPart>>,
	) => ReadonlyArray<Text | RichPart>;
};

const I18nContext = createContext<null | I18nValue>(null);

export function I18nProvider(props: {
	readonly locale: string;
	readonly children: ReactNode;
	readonly registry: CatalogRegistry;
	readonly isPending?: PendingNamespaces;
}) {
	const { locale, registry, isPending } = props;
	const value = useMemo<I18nValue>(
		() => ({
			locale,
			direction: textDirection(locale),
			formatters: formattersFor(locale),
			t: (message) => format(registry, locale, message, { isPending }),
			rich: (message, parts) => formatRich(registry, locale, message, parts, { isPending }),
		}),
		[locale, registry, isPending],
	);
	return <I18nContext value={value}>{props.children}</I18nContext>;
}

const useI18n = () => {
	const value = useContext(I18nContext);
	if (value === null) {
		throw new Error("I18nProvider is missing");
	}
	return value;
};

export const useT = () => useI18n().t;

export const useLocale = () => useI18n().locale;

export const useTextDirection = () => useI18n().direction;

export const useFormatters = () => useI18n().formatters;

/** Text arguments also accept elements, which render in place of the argument. */
export type RichTextBuilder<Catalog extends CatalogShape> = <
	const Key extends string & keyof Catalog,
>(
	key: Key,
	...params: MessageParams<Catalog[Key], Message | ReactElement>
) => ReactNode;

const renderRich = (
	rich: I18nValue["rich"],
	namespace: string,
	key: string,
	params: ReadonlyArray<
		Readonly<
			Record<
				string,
				Date | string | number | Message | ReactElement | ZonedDateTime | EntityReferenceParam
			>
		>
	>,
) => {
	const values: Record<string, MessageParam> = {};
	const parts: Record<string, RichPart> = {};
	for (const [name, value] of Object.entries(params[0] ?? {})) {
		if (isValidElement(value)) {
			parts[name] = { name, element: value };
		} else {
			values[name] = encodeParam(value);
		}
	}
	const occurrences = new Map<string, number>();
	return rich({ key, namespace, params: values }, parts).map((part) => {
		if (typeof part === "string") {
			return part;
		}
		const occurrence = occurrences.get(part.name) ?? 0;
		occurrences.set(part.name, occurrence + 1);
		return <Fragment key={`${part.name}.${occurrence}`}>{part.element}</Fragment>;
	});
};

/** Renders the builder's messages with text arguments that may be elements, such as emphasis. */
export const useRichText = <Catalog extends CatalogShape>(
	builder: MessageBuilder<Catalog>,
): RichTextBuilder<Catalog> => {
	const { rich } = useI18n();
	const { namespace } = builder;
	return useCallback<RichTextBuilder<Catalog>>(
		(key, ...params) => renderRich(rich, namespace, key, params),
		[rich, namespace],
	);
};
