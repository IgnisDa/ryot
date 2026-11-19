import type { KernelLocale } from "@ryot-app/kernel-messages/catalog";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { useI18nSnapshot } from "#/modules/i18n/provider";
import type { I18nStore, PluginCatalogLoader } from "#/modules/i18n/store";
import { useIngestionCatalogRefresh } from "#/modules/plugins/catalog/provider";
import { preferencesQuery } from "#/modules/settings/preferences-service";

/**
 * Applies the user's interface locale preference and loads plugin catalogs. Renders `fallback`
 * until the preference has settled and the kernel and plugin catalogs of its locale have loaded,
 * then keeps `children` mounted.
 */
export function AuthenticatedMessages(props: {
	readonly store: I18nStore;
	readonly fallback: ReactNode;
	readonly children: ReactNode;
	readonly load: PluginCatalogLoader;
	readonly onInterfaceLocale: (preference: null | KernelLocale) => void;
}) {
	const { load, store } = props;
	const preferences = useRyotQuery(preferencesQuery);
	const loaded = preferences.data !== undefined;
	const interfaceLocale = preferences.data?.interfaceLocale ?? null;
	const remember = useEffectEvent(props.onInterfaceLocale);
	useEffect(() => {
		store.setPluginCatalogLoader(load);
		return () => store.setPluginCatalogLoader(null);
	}, [load, store]);
	useIngestionCatalogRefresh(store.invalidatePluginCatalogs);
	useEffect(() => {
		if (loaded) {
			store.setInterfaceLocale(interfaceLocale);
			remember(interfaceLocale);
		}
	}, [interfaceLocale, loaded, store]);
	useEffect(() => () => store.setInterfaceLocale(null), [store]);
	const snapshot = useI18nSnapshot();
	const ready =
		!preferences.isPending &&
		(!loaded || snapshot.preference === interfaceLocale) &&
		snapshot.localeSettled &&
		snapshot.pluginCatalogs === "ready";
	const [settled, setSettled] = useState(false);
	if (ready && !settled) {
		setSettled(true);
	}
	return settled ? props.children : props.fallback;
}
