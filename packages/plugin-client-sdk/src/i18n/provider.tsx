import { I18nProvider } from "@ryot-app/i18n/react";
import { type ReactNode, useSyncExternalStore } from "react";

import type { PluginLocaleStore } from "./locale-store";

export function PluginI18nProvider(props: {
	readonly children: ReactNode;
	readonly store: PluginLocaleStore;
}) {
	const { locale, registry, isPending } = useSyncExternalStore(
		props.store.subscribe,
		props.store.getSnapshot,
		props.store.getSnapshot,
	);
	return (
		<I18nProvider
			locale={locale}
			registry={registry}
			{...(isPending === undefined ? {} : { isPending })}
		>
			{props.children}
		</I18nProvider>
	);
}
