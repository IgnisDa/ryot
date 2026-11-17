import { type DbError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	boundaryReasonMessage,
	stampedBoundaryReasonOfError,
} from "@ryot-app/contract/modules/scripts/boundary-reason";
import { InterfaceLocale } from "@ryot-app/contract/schema/user-preferences";
import {
	emptyCatalogRegistry,
	type NamespaceCatalog,
	registerCatalog,
} from "@ryot-app/i18n/catalog";
import { format, formatForModel, type FormatOptions } from "@ryot-app/i18n/format";
import { fallbackChain, SOURCE_LOCALE } from "@ryot-app/i18n/locale";
import {
	isMessage,
	KERNEL_NAMESPACE,
	type Message,
	messageNamespaces,
} from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { type KernelLocale, loadKernelCatalog } from "@ryot-app/kernel-messages/catalog";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Context, Effect, Layer, Schema } from "effect";

const isInterfaceLocale = Schema.is(InterfaceLocale);

/** Loads one locale's catalogs for the given non-kernel namespaces; unknown namespaces are omitted. */
export class MessageCatalogSource extends Context.Service<
	MessageCatalogSource,
	{
		readonly load: (
			namespaces: ReadonlyArray<string>,
			locale: string,
		) => Effect.Effect<ReadonlyArray<NamespaceCatalog>, DbError>;
	}
>()("@ryot-app/kernel-backend/platform/messages/MessageCatalogSource") {}

const mapMessages = (value: unknown, onMessage: (message: Message) => unknown): unknown => {
	if (isMessage(value)) {
		return onMessage(value);
	}
	if (Array.isArray(value)) {
		return value.map((item) => mapMessages(item, onMessage));
	}
	return isObjectRecord(value)
		? Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, mapMessages(item, onMessage)]),
			)
		: value;
};

/** The namespaces of every message nested in a value. */
export const valueMessageNamespaces = (value: unknown) => {
	const messages: Message[] = [];
	mapMessages(value, (message) => messages.push(message));
	return new Set(messages.flatMap((message) => Array.from(messageNamespaces(message))));
};

/** Replaces every message nested in a model-facing value with its rendered text. */
export const renderValueMessages = (value: unknown, render: (message: Message) => string) =>
	mapMessages(value, render);

export class MessageRegistry extends Context.Service<MessageRegistry>()(
	"@ryot-app/kernel-backend/platform/messages/MessageRegistry",
	{
		make: Effect.gen(function* () {
			const source = yield* MessageCatalogSource;
			const sourceKernelCatalog = yield* loadKernelCatalog(SOURCE_LOCALE);
			/** Loads the namespaces' catalogs along the locale's fallback chain once for rendering many messages. */
			const loadRegistry = Effect.fn("MessageRegistry.loadRegistry")(function* (
				locale: KernelLocale,
				namespaces: Iterable<string>,
			) {
				const pluginNamespaces = [...new Set(namespaces)].filter(
					(namespace) => namespace !== KERNEL_NAMESPACE,
				);
				let registry = emptyCatalogRegistry;
				for (const candidate of fallbackChain(locale)) {
					if (isInterfaceLocale(candidate)) {
						registry = registerCatalog(
							registry,
							KERNEL_NAMESPACE,
							candidate,
							candidate === SOURCE_LOCALE
								? sourceKernelCatalog
								: yield* loadKernelCatalog(candidate),
						);
					}
					const loaded =
						pluginNamespaces.length === 0 ? [] : yield* source.load(pluginNamespaces, candidate);
					for (const { catalog, namespace } of loaded) {
						registry = registerCatalog(registry, namespace, candidate, catalog);
					}
				}
				return registry;
			});
			const renderer = (
				locale: KernelLocale,
				namespaces: Iterable<string>,
				options?: FormatOptions,
			) =>
				Effect.map(
					loadRegistry(locale, namespaces),
					(loaded) =>
						(message: Message): Text =>
							format(loaded, locale, message, options),
				);
			/** Model-facing boundaries render in the source locale, whatever the user's interface locale. */
			const modelRenderer = (namespaces: Iterable<string>) =>
				Effect.map(
					loadRegistry(SOURCE_LOCALE, namespaces),
					(loaded) =>
						(message: Message): Text =>
							formatForModel(loaded, message),
				);
			const renderForModel = (message: Message) =>
				Effect.map(modelRenderer(messageNamespaces(message)), (render): string => render(message));
			const valueForModel = (value: unknown) => {
				const namespaces = valueMessageNamespaces(value);
				return namespaces.size === 0
					? Effect.succeed(value)
					: Effect.map(modelRenderer(namespaces), (render) => renderValueMessages(value, render));
			};
			/** Message reasons render in English, as do messages nested in coded reasons; diagnostics pass through. */
			const errorForModel = (error: unknown): Effect.Effect<string, DbError> =>
				Effect.gen(function* () {
					if (!isObjectRecord(error)) {
						return unknownToMessage(error);
					}
					const { _tag, issues, reason, message } = error;
					if (isMessage(reason)) {
						const text = yield* renderForModel(reason);
						return issues === undefined ? text : `${text} ${stableStringify(issues)}`;
					}
					const boundary = stampedBoundaryReasonOfError(error);
					if (boundary !== undefined) {
						return yield* renderForModel(boundaryReasonMessage(boundary));
					}
					if (typeof _tag === "string" && reason !== undefined) {
						return `${_tag}: ${stableStringify(yield* valueForModel(reason))}`;
					}
					if (typeof message === "string" && message.length > 0) {
						return message;
					}
					return typeof _tag === "string" ? _tag : unknownToMessage(error);
				});
			return { renderer, errorForModel, modelRenderer, renderForModel };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
