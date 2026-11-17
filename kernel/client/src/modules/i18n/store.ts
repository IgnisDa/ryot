import type { PluginLocaleCatalogs } from "@ryot-app/contract/modules/plugins/schemas";
import { InterfaceLocale } from "@ryot-app/contract/schema/user-preferences";
import {
	type CatalogRegistry,
	catalogRegistry,
	type CompiledCatalog,
} from "@ryot-app/i18n/catalog";
import { fallbackChain, negotiateLocale, SOURCE_LOCALE } from "@ryot-app/i18n/locale";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { type KernelLocale, kernelLocales } from "@ryot-app/kernel-messages/catalog";
import { Effect, Schedule, Schema } from "effect";

/**
 * `loading` while any plugin catalog load is in flight or waiting to retry, so a missing plugin
 * message may still arrive.
 */
export type PluginCatalogsState = "none" | "ready" | "loading";

export type PluginCatalogLoader = (
	locale: string,
) => Effect.Effect<PluginLocaleCatalogs["catalogs"], unknown>;

/**
 * `preference` is the applied interface locale preference (`null` follows the device), and
 * `localeSettled` says whether `locale` is the requested one or its kernel catalog failed to load.
 */
export type I18nSnapshot = {
	readonly locale: KernelLocale;
	readonly localeSettled: boolean;
	readonly registry: CatalogRegistry;
	readonly preference: null | KernelLocale;
	readonly pluginCatalogs: PluginCatalogsState;
};

export type I18nStore = {
	readonly getSnapshot: () => I18nSnapshot;
	readonly invalidatePluginCatalogs: () => void;
	readonly subscribe: (listener: () => void) => () => void;
	readonly setInterfaceLocale: (preference: null | KernelLocale) => void;
	readonly setPluginCatalogLoader: (load: null | PluginCatalogLoader) => void;
};

const pluginCatalogRetrySchedule = Schedule.exponential("1 second");
const PLUGIN_CATALOG_RETRIES = 3;

/**
 * Starts with the source catalog so rendering never waits, requesting the initial preference or else
 * the device locale; other kernel locales load before they are published, and only the latest
 * requested locale is published. Plugin catalogs load per
 * locale of the requested fallback chain and replace stale ones as they arrive; stale ones stay
 * published while they reload.
 */
export function createI18nStore(input: {
	readonly sourceCatalog: CompiledCatalog;
	readonly deviceLocales: ReadonlyArray<string>;
	readonly initialPreference?: null | KernelLocale;
	readonly run: (effect: Effect.Effect<void>) => void;
	readonly load: (locale: KernelLocale) => Effect.Effect<CompiledCatalog>;
}): I18nStore {
	const deviceLocale = negotiateLocale(input.deviceLocales, kernelLocales, SOURCE_LOCALE);
	const listeners = new Set<() => void>();
	let requested: KernelLocale = SOURCE_LOCALE;
	let preference = input.initialPreference ?? null;
	let failed: undefined | KernelLocale;
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
		pluginCatalogs: pluginCatalogsState(),
	};

	const publish = (locale: KernelLocale) => {
		publishedPlugins = plugins;
		snapshot = {
			locale,
			preference,
			pluginCatalogs: pluginCatalogsState(),
			localeSettled: locale === requested || failed === requested,
			registry: catalogRegistry(
				[...plugins].flatMap(([catalogLocale, catalogs]) =>
					catalogs.map((entry) => ({ ...entry, locale: catalogLocale })),
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

	const loadPluginCatalogs = (locale: KernelLocale) => {
		const load = pluginLoader;
		if (load === null) {
			return;
		}
		const generation = pluginGeneration;
		const missing = fallbackChain(locale).filter(
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

	const select = (next: null | KernelLocale) => {
		const locale = next ?? deviceLocale;
		preference = next;
		requested = locale;
		failed = undefined;
		loadPluginCatalogs(locale);
		const missing = fallbackChain(locale)
			.filter(Schema.is(InterfaceLocale))
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
						failed = locale;
						if (requested === locale) {
							publish(snapshot.locale);
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
