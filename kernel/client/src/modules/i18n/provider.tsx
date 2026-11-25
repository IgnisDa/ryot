import { textDirection } from "@ryot-app/i18n/locale";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { I18nProvider } from "@ryot-app/i18n/react";
import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from "react";

import type { I18nSnapshot, I18nStore } from "#/modules/i18n/store";

const I18nSnapshotContext = createContext<null | I18nSnapshot>(null);

export const useI18nSnapshot = () => {
	const snapshot = useContext(I18nSnapshotContext);
	if (snapshot === null) {
		throw new Error("KernelI18nProvider is missing");
	}
	return snapshot;
};

const isPluginNamespace = (namespace: string) => namespace !== KERNEL_NAMESPACE;

export function KernelI18nProvider(props: {
	readonly store: I18nStore;
	readonly children: ReactNode;
}) {
	const snapshot = useSyncExternalStore(
		props.store.subscribe,
		props.store.getSnapshot,
		props.store.getSnapshot,
	);
	const { locale, registry, catalogLocale, pluginCatalogs } = snapshot;
	useEffect(() => {
		document.documentElement.lang = catalogLocale;
		document.documentElement.dir = textDirection(catalogLocale);
	}, [catalogLocale]);
	return (
		<I18nSnapshotContext value={snapshot}>
			<I18nProvider
				locale={locale}
				registry={registry}
				{...(pluginCatalogs === "loading" ? { isPending: isPluginNamespace } : {})}
			>
				{props.children}
			</I18nProvider>
		</I18nSnapshotContext>
	);
}
