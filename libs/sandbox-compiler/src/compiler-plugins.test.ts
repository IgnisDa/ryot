import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { compilePluginSandboxEntries } from "./compiler-plugins";

const digest = (value: string) => {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(value);
	return hasher.digest("hex");
};

it.effect("compiles plugin scripts in deterministic order with package-local shared modules", () =>
	Effect.gen(function* () {
		const packageRoot = new URL("../test-fixtures/multi-file-plugin", import.meta.url).pathname;
		const scripts = [{ entry: "scripts/zeta.sandbox.ts" }, { entry: "scripts/alpha.sandbox.ts" }];
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
			expect(result.compiled.driverNames).toEqual(["main"]);
		}
	}),
);
