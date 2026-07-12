import { expect, it } from "vitest";

import { isNeutralPluginModule, isTrustedClientModule } from "./dependencies";

it("derives the exact trusted and neutral client import policies from the registry", () => {
	const trusted = [
		"clsx",
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@ryot-app/client-sdk",
		"@ryot-app/client-sdk/effect",
		"@ryot-app/client-sdk/plugin",
		"@ryot-app/client-sdk/react",
		"@ryot-app/client-sdk/ryotql",
		"@ryot-app/client-sdk/screen",
		"@ryot-app/ryotql-recipes/saved-views",
		"@ryot-app/client-ui-sdk",
		"@ryot-app/client-ui-sdk/icon",
		"@ryot-app/client-ui-sdk/sync",
		"@ryot-app/client-ui-sdk/tint",
		"@ryot-app/client-ui-sdk/table",
		"@ryot-app/client-ui-sdk/schema-form",
	];
	const neutral = [
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
		"@ryot-app/client-sdk/unknown",
		"@ryot-app/client-ui-sdk/unknown",
		"@tanstack/react-table",
	]) {
		expect(isTrustedClientModule(specifier)).toBe(false);
		expect(isNeutralPluginModule(specifier)).toBe(false);
	}
});
