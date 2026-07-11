import { expect, it } from "@effect/vitest";
import { compileBuiltInSandboxEntry } from "@ryot/sandbox-compiler/builtins";
import { Effect } from "effect";

const entry = `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";
import { value } from "./helper";

export const manifest = defineManifest({
  kind: "provider",
  name: "Built-in provider",
  slug: "builtin.provider",
	capabilities: [],
	requiredAppConfigKeys: [],
});

export default defineProvider({
	manifest,
	operation: "resolve",
	run: () => Effect.succeed({ externalId: value }),
});
`;

it.effect("compiles a trusted provider with a relative helper into one ESM module", () =>
	Effect.gen(function* () {
		const result = yield* compileBuiltInSandboxEntry({
			entry: "provider.sandbox.ts",
			files: {
				"helper.ts": 'export const value = "resolved-id";',
				"provider.sandbox.ts": entry,
			},
		});

		expect(result.compiled.format).toBe(1);
		expect(result.compiled.manifest).toEqual({
			kind: "provider",
			capabilities: [],
			slug: "builtin.provider",
			name: "Built-in provider",
			requiredAppConfigKeys: [],
		});
		expect(result.compiled.javascript).toContain("resolved-id");
		expect(result.compiled.javascript).not.toContain('from "./helper"');
		expect(result.compiled.javascript).toContain("sourceMappingURL=data:application/json;base64,");
	}),
);
