import { describe, expect, it } from "bun:test";

import { generateCatalogModules, generateLocalBuilderModule } from "./codegen";

describe("catalog code generation", () => {
	it("emits key types, locales, lazy loaders and data modules", () => {
		const modules = generateCatalogModules({
			typeName: "TestCatalog",
			localesName: "testLocales",
			localeTypeName: "TestLocale",
			loaderName: "loadTestCatalog",
			localeModule: (locale) => `./locales/${locale}.generated`,
			descriptions: new Map([["item.count", "Shown on cards"]]),
			catalogs: new Map([
				["en", { "item.plain": [{ type: 0, value: "Plain" }] }],
				["en-XA", { "item.plain": [{ type: 0, value: "[Þļååîîñ]" }] }],
			]),
			arguments: new Map([
				["item.plain", {}],
				[
					"item.count",
					{ count: { kind: "number" }, status: { kind: "select", codes: ["done", "open"] } },
				],
			]),
		});
		expect(modules.index).toContain(
			'import type { NoArguments, NumberArgument, SelectArgument } from "@ryot-app/i18n/builder";',
		);
		expect(modules.index).toContain(
			'\t/** Shown on cards */\n\treadonly "item.count": { readonly count: NumberArgument; readonly status: SelectArgument<"done" | "open">; };',
		);
		expect(modules.index).toContain('\treadonly "item.plain": NoArguments;');
		expect(modules.index).toContain('export const testLocales = ["en", "en-XA"] as const;');
		expect(modules.index).toContain('\t"en-XA": () => import("./locales/en-XA.generated"),');
		expect(modules.locales.map(({ locale }) => locale)).toEqual(["en", "en-XA"]);
		expect(modules.locales[0]?.content).toContain(
			'export const catalog: CompiledCatalog = {"item.plain":[{"type":0,"value":"Plain"}]};',
		);
	});

	it("emits a local builder module typed by the catalog", () => {
		const module = generateLocalBuilderModule({
			typeName: "Catalog",
			descriptions: new Map(),
			builderName: "catalogMessage",
			bindingBuilderName: "catalogRowText",
			builderModule: "@ryot-app/plugin-kit/messages",
			arguments: new Map([
				["item.plain", {}],
				["item.count", { count: { kind: "number" } }],
			]),
		});
		expect(module).toStartWith(
			'import { localBindingBuilder, localMessageBuilder, type NoArguments, type NumberArgument } from "@ryot-app/plugin-kit/messages";',
		);
		expect(module).toContain('\treadonly "item.count": { readonly count: NumberArgument; };');
		expect(module).toContain("export const catalogMessage = localMessageBuilder<Catalog>();");
		expect(module).toContain("export const catalogRowText = localBindingBuilder<Catalog>();");
	});
});
