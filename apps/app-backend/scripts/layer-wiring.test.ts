import { expect, it } from "@effect/vitest";

import { findDuplicateServiceLayers } from "./layer-wiring";

const source = (body: string) => [{ source: body, path: "app/layers.ts" }];

it("accepts duplicate bindings when all but one opt out of the memo", () => {
	expect(
		findDuplicateServiceLayers(
			source(`
				const A = Layer.provide(PluginInstallationService.layer, migration);
				const B = Layer.provide(Layer.fresh(PluginInstallationService.layer), runtime);
			`),
		),
	).toEqual([]);
});

it("ignores a layer supplied as a dependency rather than built", () => {
	expect(
		findDuplicateServiceLayers(
			source(`
				const A = SignalDispatchLive.pipe(Layer.provide(AutomationsService.layer));
				const B = LifecycleDispatchLive.pipe(Layer.provide(AutomationsService.layer));
			`),
		),
	).toEqual([]);
});

it("reports duplicate bindings that would collapse onto one memoized instance", () => {
	const findings = findDuplicateServiceLayers(
		source(`
			const A = Layer.provide(PluginInstallationService.layer, migration);
			const B = Layer.provide(PluginInstallationService.layer, runtime);
		`),
	);

	expect(findings).toHaveLength(1);
	expect(findings[0]).toContain("PluginInstallationService.layer is built 2 times");
});
