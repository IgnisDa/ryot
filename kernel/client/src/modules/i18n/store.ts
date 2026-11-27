import type { PluginLocaleCatalogs } from "@ryot-app/contract/modules/plugins/schemas";
import {
	catalogLocale,
	type CatalogRegistry,
	catalogRegistry,
	type CompiledCatalog,
} from "@ryot-app/i18n/catalog";
import { fallbackChain, SOURCE_LOCALE } from "@ryot-app/i18n/locale";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { type KernelLocale, kernelLocales } from "@ryot-app/kernel-messages/catalog";
import { Effect, Schedule, Schema } from "effect";

import { resolveDeviceLocale } from "./device-locale";

/**
 * `loading` while any plugin catalog load is in flight or waiting to retry, so a missing plugin
 * message may still arrive.
 */
export type PluginCatalogsState = "none" | "ready" | "loading";

export type PluginCatalogLoader = (
	locale: string,
) => Effect.Effect<PluginLocaleCatalogs["catalogs"], unknown>;

/**
 * `localeSettled` says whether the requested kernel catalogs loaded or failed.
 */
export type I18nSnapshot = {
	readonly locale: string;
	readonly catalogLocale: string;
	readonly localeSettled: boolean;
	readonly registry: CatalogRegistry;
	readonly preference: null | string;
	readonly pluginCatalogs: PluginCatalogsState;
};

export type I18nStore = {
	readonly deviceLocale: string;
	readonly getSnapshot: () => I18nSnapshot;
	readonly invalidatePluginCatalogs: () => void;
	readonly subscribe: (listener: () => void) => () => void;
	readonly setInterfaceLocale: (preference: null | string) => void;
	readonly setPluginCatalogLoader: (load: null | PluginCatalogLoader) => void;
};

const pluginCatalogRetrySchedule = Schedule.exponential("1 second");
const PLUGIN_CATALOG_RETRIES = 3;
const isKernelLocale = Schema.is(Schema.Literals(kernelLocales));

/**
 * Starts with the source catalog so rendering never waits, requesting the initial preference or else
 * the device locale; other kernel locales load before they are published, and only the latest
 * requested locale is published. Plugin catalogs load per
 * locale of the requested fallback chain and replace stale ones as they arrive; stale ones stay
 * published while they reload.
 */
export function createI18nStore(input: {
	readonly sourceCatalog: CompiledCatalog;
	readonly initialPreference?: null | string;
	readonly deviceLocales: ReadonlyArray<string>;
	readonly run: (effect: Effect.Effect<void>) => void;
	readonly load: (locale: KernelLocale) => Effect.Effect<CompiledCatalog>;
}): I18nStore {
	const deviceLocale = resolveDeviceLocale(input.deviceLocales);
	const listeners = new Set<() => void>();
	let requested: string = SOURCE_LOCALE;
	let preference = input.initialPreference ?? null;
	let kernel = catalogRegistry([
		{ locale: SOURCE_LOCALE, namespace: KERNEL_NAMESPACE, catalog: input.sourceCatalog },
	]);
	let plugins = new Map<string, PluginLocaleCatalogs["catalogs"]>();
	let pluginLoader: null | PluginCatalogLoader = null;
	let pluginGeneration = 0;
	const freshPluginLocales = new Set<string>();
	const pendingPluginLocales = new Set<string>();
	const pluginCatalogsState = (): PluginCatalogsState => {
		if (pluginLoader === null) {
			return "none";
		}
		return pendingPluginLocales.size > 0 ? "loading" : "ready";
	};
	let publishedPlugins = plugins;
	let snapshot: I18nSnapshot = {
		preference,
		registry: kernel,
		localeSettled: true,
		locale: SOURCE_LOCALE,
		catalogLocale: SOURCE_LOCALE,
		pluginCatalogs: pluginCatalogsState(),
	};

	const publish = (locale: string) => {
		publishedPlugins = plugins;
		snapshot = {
			locale,
			preference,
			localeSettled: locale === requested,
			pluginCatalogs: pluginCatalogsState(),
			catalogLocale: catalogLocale(kernel, locale),
			registry: catalogRegistry(
				[...plugins].flatMap(([candidate, catalogs]) =>
					catalogs.map((entry) => ({ ...entry, locale: candidate })),
				),
				kernel,
			),
		};
		for (const listener of listeners) {
			listener();
		}
	};

	const publishPluginChanges = () => {
		if (publishedPlugins !== plugins || snapshot.pluginCatalogs !== pluginCatalogsState()) {
			publish(snapshot.locale);
		}
	};

	const loadPluginCatalogs = (locale: string) => {
		const load = pluginLoader;
		if (load === null) {
			return;
		}
		const generation = pluginGeneration;
		const missing = fallbackChain(locale, kernelLocales).filter(
			(candidate) => !freshPluginLocales.has(candidate) && !pendingPluginLocales.has(candidate),
		);
		for (const candidate of missing) {
			pendingPluginLocales.add(candidate);
		}
		publishPluginChanges();
		for (const candidate of missing) {
			input.run(
				Effect.matchCause(
					Effect.retry(load(candidate), {
						times: PLUGIN_CATALOG_RETRIES,
						schedule: pluginCatalogRetrySchedule,
						while: () => generation === pluginGeneration,
					}),
					{
						onFailure: () => {
							if (generation === pluginGeneration) {
								pendingPluginLocales.delete(candidate);
								publishPluginChanges();
							}
						},
						onSuccess: (catalogs) => {
							if (generation !== pluginGeneration) {
								return;
							}
							pendingPluginLocales.delete(candidate);
							freshPluginLocales.add(candidate);
							if (JSON.stringify(plugins.get(candidate)) !== JSON.stringify(catalogs)) {
								plugins = new Map(plugins).set(candidate, catalogs);
							}
							publishPluginChanges();
						},
					},
				),
			);
		}
	};

	const select = (next: null | string) => {
		const locale = next ?? deviceLocale;
		preference = next;
		requested = locale;
		loadPluginCatalogs(locale);
		const missing = fallbackChain(locale, kernelLocales)
			.filter(isKernelLocale)
			.filter((candidate) => kernel.get(KERNEL_NAMESPACE)?.has(candidate) !== true);
		if (missing.length === 0) {
			if (
				snapshot.locale !== locale ||
				snapshot.preference !== preference ||
				!snapshot.localeSettled
			) {
				publish(locale);
			}
			return;
		}
		publish(snapshot.locale);
		input.run(
			Effect.matchCause(
				Effect.forEach(missing, (candidate) =>
					Effect.map(input.load(candidate), (catalog) => ({
						catalog,
						locale: candidate,
						namespace: KERNEL_NAMESPACE,
					})),
				),
				{
					onFailure: () => {
						if (requested === locale) {
							publish(locale);
						}
					},
					onSuccess: (loaded) => {
						kernel = catalogRegistry(loaded, kernel);
						publish(requested === locale ? locale : snapshot.locale);
					},
				},
			),
		);
	};

	const resetPluginCatalogs = () => {
		pluginGeneration += 1;
		freshPluginLocales.clear();
		pendingPluginLocales.clear();
	};

	select(preference);

	return {
		deviceLocale,
		setInterfaceLocale: select,
		getSnapshot: () => snapshot,
		invalidatePluginCatalogs: () => {
			resetPluginCatalogs();
			loadPluginCatalogs(requested);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setPluginCatalogLoader: (load) => {
			resetPluginCatalogs();
			pluginLoader = load;
			if (plugins.size > 0) {
				plugins = new Map();
			}
			loadPluginCatalogs(requested);
			publishPluginChanges();
		},
	};
}
