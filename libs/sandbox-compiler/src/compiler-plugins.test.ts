import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { compilePluginSandboxEntries, compilePluginSandboxSourceEntries } from "./compiler-plugins";

const digest = (value: string) => {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(value);
	return hasher.digest("hex");
};

it.effect("compiles plugin scripts in deterministic order with package-local shared modules", () =>
	Effect.gen(function* () {
		const packageRoot = new URL("../test-fixtures/multi-file-plugin", import.meta.url).pathname;
		const scripts = [
			{
				kind: "script",
				entry: "scripts/zeta.sandbox.ts",
			},
			{
				kind: "script",
				entry: "scripts/alpha.sandbox.ts",
			},
		] as const;
		const first = yield* compilePluginSandboxEntries(packageRoot, scripts);
		const second = yield* compilePluginSandboxEntries(packageRoot, scripts.toReversed());

		expect(first.map(({ entry }) => entry)).toEqual([
			"scripts/alpha.sandbox.ts",
			"scripts/zeta.sandbox.ts",
		]);
		expect(first.map(({ compiled }) => digest(compiled.javascript))).toEqual(
			second.map(({ compiled }) => digest(compiled.javascript)),
		);
		for (const result of first) {
			expect(result.compiled.javascript).toContain("shared-value");
			expect(result.compiled.javascript).toContain('from "@ryot/sandbox-sdk/effect"');
			expect(result.compiled.javascript).not.toContain('from "../shared/value"');
			expect(Object.keys(result.compiled).sort()).toEqual(["format", "javascript", "manifest"]);
		}
	}),
);

it.effect("compiles direct operation and automation declarations", () =>
	Effect.gen(function* () {
		const operation = `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

export const manifest = defineManifest({
	name: "Operation",
	slug: "operation",
	kind: "operation",
	capabilities: [],
	requiredAppConfigKeys: [],
});

export default defineOperation({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.die("unused"),
});
`;
		const automation = `
import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
	name: "Automation",
	slug: "automation",
	kind: "automation",
	capabilities: [],
	requiredAppConfigKeys: [],
});

export default defineAutomation({
	manifest,
	run: () => Effect.die("unused"),
});
`;
		const compiled = yield* compilePluginSandboxSourceEntries(
			{
				"operation.sandbox.ts": operation,
				"automation.sandbox.ts": automation,
			},
			[
				{ kind: "operation", entry: "operation.sandbox.ts" },
				{ kind: "automation", entry: "automation.sandbox.ts" },
			],
		);

		expect(compiled.map(({ compiled: { manifest } }) => manifest.kind)).toEqual([
			"automation",
			"operation",
		]);
	}),
);

it.effect("rejects a provider operation that differs from its plugin declaration", () =>
	Effect.gen(function* () {
		const source = `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

export const manifest = defineManifest({
	name: "Provider",
	slug: "provider",
	kind: "provider",
	capabilities: [],
	requiredAppConfigKeys: [],
});

export default defineProvider({
	manifest,
	operation: "details",
	run: () => Effect.die("unused"),
});
`;
		const failure = yield* compilePluginSandboxSourceEntries({ "provider.sandbox.ts": source }, [
			{
				kind: "provider",
				providerOperation: "search",
				entry: "provider.sandbox.ts",
			},
		]).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message:
					'Provider definition operation "details" does not match plugin declaration "search"',
			}),
		]);
	}),
);

it.effect("rejects obsolete multi-driver definitions with a clear diagnostic", () =>
	Effect.gen(function* () {
		const source = `
import { defineDriver, defineManifest, defineOperation } from "@ryot/sandbox-sdk/driver";

export const manifest = defineManifest({
	name: "Old operation",
	slug: "old-operation",
	kind: "operation",
	capabilities: [],
	requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {});
export default defineOperation({ manifest, drivers: { main } });
`;
		const failure = yield* compilePluginSandboxSourceEntries({ "old.sandbox.ts": source }, [
			{ kind: "operation", entry: "old.sandbox.ts" },
		]).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message: "defineDriver is obsolete; export one direct definition helper call instead",
			}),
		]);
	}),
);
