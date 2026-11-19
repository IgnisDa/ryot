import { describe, expect } from "bun:test";

import type { CompiledCatalog } from "@ryot-app/i18n/catalog";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { createI18nStore } from "#/modules/i18n/store";

const sourceCatalog: CompiledCatalog = { "message.unavailable": [{ type: 0, value: "Gone" }] };
const pseudoCatalog: CompiledCatalog = { "message.unavailable": [{ type: 0, value: "[Ĝöñé]" }] };

const harness = (
	deviceLocales: ReadonlyArray<string>,
	options: {
		readonly initialPreference?: "en" | "en-XA";
		readonly load?: Parameters<typeof createI18nStore>[0]["load"];
	} = {},
) => {
	const pending: Array<Effect.Effect<void>> = [];
	const loads: Array<string> = [];
	const store = createI18nStore({
		deviceLocales,
		sourceCatalog,
		run: (effect) => pending.push(effect),
		initialPreference: options.initialPreference ?? null,
		load:
			options.load ??
			((locale) =>
				Effect.sync(() => {
					loads.push(locale);
					return pseudoCatalog;
				})),
	});
	const flush = () => {
		for (const effect of pending.splice(0)) {
			Effect.runSync(effect);
		}
	};
	return { flush, loads, store, pending };
};

const loadedLocales = (
	snapshot: ReturnType<ReturnType<typeof harness>["store"]["getSnapshot"]>,
) => [...(snapshot.registry.get(KERNEL_NAMESPACE)?.keys() ?? [])];

describe("kernel i18n store", () => {
	it("renders English immediately and switches to the device locale once it loads", () => {
		const { flush, loads, store } = harness(["en-XA", "fr"]);
		const notifications: Array<string> = [];
		store.subscribe(() => notifications.push(store.getSnapshot().locale));
		expect(store.getSnapshot().locale).toBe("en");
		flush();
		expect(loads).toEqual(["en-XA"]);
		expect(notifications).toEqual(["en-XA"]);
		expect(loadedLocales(store.getSnapshot())).toEqual(["en", "en-XA"]);
	});

	it("prefers the saved interface locale and returns to the device locale when cleared", () => {
		const { flush, loads, store } = harness(["ar-EG"]);
		store.setInterfaceLocale("en-XA");
		flush();
		expect(store.getSnapshot().locale).toBe("en-XA");
		store.setInterfaceLocale(null);
		expect(store.getSnapshot().locale).toBe("en");
		store.setInterfaceLocale("en-XA");
		expect(store.getSnapshot().locale).toBe("en-XA");
		expect(loads).toEqual(["en-XA"]);
	});

	it("negotiates new regional and script locales and loads their plugin fallback chains", () => {
		for (const [device, locale, chain] of [
			["fr-CA", "fr", ["fr", "en"]],
			["pt-BR", "pt-BR", ["pt-BR", "pt", "en"]],
			["pt-PT", "pt-PT", ["pt-PT", "pt", "en"]],
			["es-ES", "es-ES", ["es-ES", "es", "en"]],
			["zh-CN", "zh-Hans", ["zh-Hans", "zh", "en"]],
			["zh-TW", "en", ["en"]],
		] as const) {
			const { flush, store } = harness([device]);
			const requests: string[] = [];
			store.setPluginCatalogLoader((candidate) =>
				Effect.sync(() => {
					requests.push(candidate);
					return [];
				}),
			);
			flush();
			expect(store.getSnapshot().locale).toBe(locale);
			expect(requests).toEqual([...chain]);
		}
	});

	it("loads plugin catalogs for the locale chain, refreshes them on invalidation and drops them without a loader", () => {
		const { flush, store } = harness(["en-XA"]);
		const requests: Array<string> = [];
		let label = "First";
		expect(store.getSnapshot().pluginCatalogs).toBe("none");
		store.setPluginCatalogLoader((locale) =>
			Effect.sync(() => {
				requests.push(locale);
				return [{ namespace: "plugin-1", catalog: { "plugin.name": [{ type: 0, value: label }] } }];
			}),
		);
		expect(store.getSnapshot().pluginCatalogs).toBe("loading");
		flush();
		const pluginLocales = () => [...(store.getSnapshot().registry.get("plugin-1")?.keys() ?? [])];
		expect(requests).toEqual(["en-XA", "en"]);
		expect(pluginLocales()).toEqual(["en-XA", "en"]);
		expect(store.getSnapshot().pluginCatalogs).toBe("ready");
		label = "Second";
		store.invalidatePluginCatalogs();
		expect(store.getSnapshot().pluginCatalogs).toBe("loading");
		expect(pluginLocales()).toEqual(["en-XA", "en"]);
		flush();
		expect(requests).toEqual(["en-XA", "en", "en-XA", "en"]);
		expect(store.getSnapshot().pluginCatalogs).toBe("ready");
		expect(store.getSnapshot().registry.get("plugin-1")?.get("en")).toEqual({
			"plugin.name": [{ type: 0, value: "Second" }],
		});
		store.setPluginCatalogLoader(null);
		expect(store.getSnapshot().pluginCatalogs).toBe("none");
		expect(store.getSnapshot().registry.has("plugin-1")).toBe(false);
		expect(store.getSnapshot().registry.has(KERNEL_NAMESPACE)).toBe(true);
	});

	it.effect(
		"keeps plugin catalogs loading while failed loads retry and settles once retries run out",
		() =>
			Effect.gen(function* () {
				const { store, pending } = harness([]);
				let attempts = 0;
				store.setPluginCatalogLoader(() =>
					Effect.suspend(() => {
						attempts += 1;
						return attempts < 3
							? Effect.fail("unreachable")
							: Effect.succeed([
									{
										namespace: "plugin-1",
										catalog: { "plugin.name": [{ type: 0, value: "One" }] },
									},
								]);
					}),
				);
				const fibers = yield* Effect.forEach(pending.splice(0), (effect) =>
					Effect.forkChild(effect),
				);
				yield* TestClock.adjust("1 second");
				expect(store.getSnapshot().pluginCatalogs).toBe("loading");
				yield* TestClock.adjust("2 seconds");
				yield* Effect.forEach(fibers, Fiber.join);
				expect(store.getSnapshot().pluginCatalogs).toBe("ready");
				expect(store.getSnapshot().registry.has("plugin-1")).toBe(true);

				store.setPluginCatalogLoader(() => Effect.fail("unreachable"));
				const failing = yield* Effect.forEach(pending.splice(0), (effect) =>
					Effect.forkChild(effect),
				);
				yield* TestClock.adjust("10 seconds");
				yield* Effect.forEach(failing, Fiber.join);
				expect(store.getSnapshot().pluginCatalogs).toBe("ready");
			}),
		testTimeout,
	);

	it("seeds the remembered preference and settles once its kernel catalog loads or fails", () => {
		const seeded = harness(["ar"], { initialPreference: "en-XA" });
		expect(seeded.store.getSnapshot()).toMatchObject({
			locale: "en",
			preference: "en-XA",
			localeSettled: false,
		});
		seeded.flush();
		expect(seeded.store.getSnapshot()).toMatchObject({ locale: "en-XA", localeSettled: true });

		const failing = harness(["ar"], {
			initialPreference: "en-XA",
			load: () => Effect.die("offline"),
		});
		expect(failing.store.getSnapshot().localeSettled).toBe(false);
		failing.flush();
		expect(failing.store.getSnapshot()).toMatchObject({ locale: "en", localeSettled: true });
	});

	it("publishes only the latest requested locale when an older load finishes", () => {
		const { flush, store } = harness([]);
		store.setInterfaceLocale("en-XA");
		store.setInterfaceLocale("en");
		flush();
		expect(store.getSnapshot().locale).toBe("en");
		expect(loadedLocales(store.getSnapshot())).toEqual(["en", "en-XA"]);
	});
});
