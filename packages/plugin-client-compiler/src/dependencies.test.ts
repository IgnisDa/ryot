import { expect, it } from "vitest";

import { isNeutralPluginModule, isTrustedClientModule } from "./dependencies";

it("derives the exact trusted and neutral client import policies from the registry", () => {
	const trusted = [
		"clsx",
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@ryot-app/plugin-client-sdk",
		"@ryot-app/plugin-client-sdk/effect",
		"@ryot-app/plugin-client-sdk/entity-editor",
		"@ryot-app/plugin-client-sdk/filters",
		"@ryot-app/plugin-client-sdk/plugin",
		"@ryot-app/plugin-client-sdk/react",
		"@ryot-app/plugin-client-sdk/ryotql",
		"@ryot-app/plugin-client-sdk/screen",
		"@ryot-app/ryotql-recipes/collections",
		"@ryot-app/ryotql-recipes/filters",
		"@ryot-app/ryotql-recipes/saved-views",
		"@ryot-app/plugin-ui-sdk",
		"@ryot-app/plugin-ui-sdk/icon",
		"@ryot-app/plugin-ui-sdk/markdown",
		"@ryot-app/plugin-ui-sdk/sync",
		"@ryot-app/plugin-ui-sdk/tint",
		"@ryot-app/plugin-ui-sdk/table",
		"@ryot-app/plugin-ui-sdk/charts",
		"@ryot-app/plugin-ui-sdk/schema-form",
	];
	const neutral = [
		"@ryot-app/plugin-kit/compression",
		"@ryot-app/plugin-kit/effect",
		"@ryot-app/plugin-kit/ryotql",
		"@ryot-app/plugin-kit/schema",
	];
	for (const specifier of trusted) {
		expect(isTrustedClientModule(specifier)).toBe(true);
		expect(isNeutralPluginModule(specifier)).toBe(false);
	}
	for (const specifier of neutral) {
		expect(isTrustedClientModule(specifier)).toBe(false);
		expect(isNeutralPluginModule(specifier)).toBe(true);
	}
	for (const specifier of [
		"clsx/lite",
		"@ryot-app/plugin-client-sdk/bootstrap",
		"@ryot-app/plugin-client-sdk/unknown",
		"@ryot-app/plugin-ui-sdk/unknown",
		"@ryot-app/plugin-ui-sdk/markdown/internal",
		"react-markdown",
		"remark-directive",
		"fflate",
		"@tanstack/react-table",
		"@tanstack/charts",
		"@tanstack/charts/react",
	]) {
		expect(isTrustedClientModule(specifier)).toBe(false);
		expect(isNeutralPluginModule(specifier)).toBe(false);
	}
});
