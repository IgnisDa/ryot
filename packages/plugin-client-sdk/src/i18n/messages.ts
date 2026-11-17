import {
	isPluginCommonMessageKey,
	type PluginCommonMessageKey,
} from "@ryot-app/contract/modules/plugins/common-messages";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type {
	CatalogShape,
	LocalMessageBuilder,
	LocalTextBuilder,
	MessageParams,
} from "@ryot-app/i18n/builder";
import { formatDisplayText } from "@ryot-app/i18n/format";
import {
	type DisplayText,
	type LocalMessage,
	type Message,
	stampNamespace,
} from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import type { KernelCatalog } from "@ryot-app/kernel-messages/catalog";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useCallback, useMemo } from "react";

import { useRyot } from "../queries/provider";

type WithCommonMessages<Catalog extends CatalogShape> = Catalog &
	Pick<KernelCatalog, PluginCommonMessageKey>;

/** Renders a plugin's messages with `t`, as `useMessages` does. */
export const pluginText = <Catalog extends CatalogShape>(
	t: (message: Message) => Text,
	pluginId: string,
	builder: LocalMessageBuilder<Catalog>,
): LocalTextBuilder<WithCommonMessages<Catalog>> => {
	const local: LocalMessageBuilder<WithCommonMessages<Catalog>> = builder;
	return (key, ...params) =>
		t(
			isPluginCommonMessageKey(key)
				? kernelMessage<PluginCommonMessageKey>(key)
				: stampNamespace(pluginId, local(key, ...params)),
		);
};

/**
 * Renders the plugin's own messages and the kernel's common messages (`PLUGIN_COMMON_MESSAGE_KEYS`):
 * `builder` is the generated `catalogMessage`, and the namespace is the plugin ID the host resolves
 * for `packageId`.
 */
export const useMessages = <Catalog extends CatalogShape>(
	packageId: PluginPackageId,
	builder: LocalMessageBuilder<Catalog>,
): LocalTextBuilder<WithCommonMessages<Catalog>> => {
	const t = useT();
	const { pluginId } = useRyot().pluginIdentity(packageId);
	return useMemo(() => pluginText(t, pluginId, builder), [t, pluginId, builder]);
};

export type StampedMessageBuilder<Catalog extends CatalogShape> = <
	const Key extends string & keyof Catalog,
>(
	key: Key,
	...params: MessageParams<Catalog[Key], LocalMessage>
) => Message;

/**
 * Builds the plugin's own messages stamped with its resolved namespace, for display text the host
 * renders, such as a screen title.
 */
export const useStampedMessages = <Catalog extends CatalogShape>(
	packageId: PluginPackageId,
	builder: LocalMessageBuilder<Catalog>,
): StampedMessageBuilder<Catalog> => {
	const { pluginId } = useRyot().pluginIdentity(packageId);
	return useCallback<StampedMessageBuilder<Catalog>>(
		(key, ...params) => stampNamespace(pluginId, builder(key, ...params)),
		[pluginId, builder],
	);
};

/** Renders a local message the plugin's own backend returned, such as an operation outcome. */
export const useLocalMessage = (packageId: PluginPackageId) => {
	const t = useT();
	const { pluginId } = useRyot().pluginIdentity(packageId);
	return useCallback(
		(message: LocalMessage) => t(stampNamespace(pluginId, message)),
		[t, pluginId],
	);
};

/** Renders stored display text: user-authored text unchanged, message references through `useT`. */
export const useDisplayText = () => {
	const t = useT();
	return useCallback((text: DisplayText) => formatDisplayText(t, text), [t]);
};
