import { format } from "@ryot-app/i18n/format";
import type { Message } from "@ryot-app/i18n/message";
import { catalog as sourceCatalog } from "@ryot-app/kernel-messages/locales/en";
import type { PluginBridgeCatalog } from "@ryot-app/plugin-client-contract";
import { testCatalog } from "@ryot-app/plugin-client-sdk/testing";
import { Effect } from "effect";
import { type ReactNode, useState } from "react";

import { KernelI18nProvider } from "#/modules/i18n/provider";
import { createI18nStore } from "#/modules/i18n/store";

const testMessageKey = (text: string) =>
	`text.t-${text
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-|-$/g, "")}`;

export const testMessage = (text: string): Message => ({
	namespace: "test",
	key: testMessageKey(text),
});

export const testMessageCatalog = (...texts: readonly string[]) =>
	testCatalog("test", Object.fromEntries(texts.map((text) => [testMessageKey(text), text])));

export const testI18nStore = (catalogs: readonly PluginBridgeCatalog[] = []) => {
	const store = createI18nStore({
		sourceCatalog,
		deviceLocales: [],
		run: (effect) => Effect.runSync(effect),
		load: () => Effect.succeed(sourceCatalog),
	});
	store.setPluginCatalogLoader((locale) =>
		Effect.succeed(
			catalogs
				.filter((entry) => entry.locale === locale)
				.map(({ catalog, namespace }) => ({ catalog, namespace })),
		),
	);
	return store;
};

export const testTranslate = (catalogs: readonly PluginBridgeCatalog[] = []) => {
	const { locale, registry } = testI18nStore(catalogs).getSnapshot();
	return (message: Message) => format(registry, locale, message);
};

export function TestKernelI18nProvider(props: {
	readonly children: ReactNode;
	readonly catalogs?: readonly PluginBridgeCatalog[];
}) {
	const [store] = useState(() => testI18nStore(props.catalogs));
	return <KernelI18nProvider store={store}>{props.children}</KernelI18nProvider>;
}

export const testI18nWrapper =
	(catalogs: readonly PluginBridgeCatalog[] = []) =>
	(props: { readonly children: ReactNode }) => (
		<TestKernelI18nProvider catalogs={catalogs}>{props.children}</TestKernelI18nProvider>
	);
