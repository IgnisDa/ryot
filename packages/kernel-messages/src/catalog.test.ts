import { describe, expect } from "bun:test";

import { catalogRegistry } from "@ryot-app/i18n/catalog";
import { format } from "@ryot-app/i18n/format";
import { KERNEL_NAMESPACE, unavailableMessage } from "@ryot-app/i18n/message";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { kernelLocales, loadKernelCatalog } from "./catalog.generated";
import { kernelMessage } from "./message";

const loadRegistry = Effect.map(
	Effect.forEach(kernelLocales, (locale) =>
		Effect.map(loadKernelCatalog(locale), (catalog) => ({
			locale,
			catalog,
			namespace: KERNEL_NAMESPACE,
		})),
	),
	(loaded) => catalogRegistry(loaded),
);

describe("kernel catalogs", () => {
	it.effect("load every shipped locale with the same keys as English", () =>
		Effect.gen(function* () {
			const registry = yield* loadRegistry;
			const catalogs = registry.get(KERNEL_NAMESPACE);
			const keys = Object.keys(catalogs?.get("en") ?? {}).sort();
			expect(keys).toContain(unavailableMessage.key);
			for (const locale of kernelLocales) {
				expect(Object.keys(catalogs?.get(locale) ?? {}).sort()).toEqual(keys);
			}
		}),
	);

	it.effect("render typed kernel messages in English and the pseudo-locale", () =>
		Effect.gen(function* () {
			const registry = yield* loadRegistry;
			const message = kernelMessage("settings.preferences.week-start.default", { day: "Monday" });
			expect<string>(format(registry, "en", message)).toBe("Language default (Monday)");
			expect<string>(format(registry, "en-XA", message)).toMatch(/^\[.+\(Monday\)\]$/);
		}),
	);
});
