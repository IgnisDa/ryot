import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { makeSandboxCompilerSupervisor } from "./compiler-supervisor";
import { SANDBOX_COMPILER_WARM_UP_SOURCE } from "./compiler-warm-up";

const workerPath = Bun.fileURLToPath(new URL("./compiler-worker.ts", import.meta.url));

layer(BunServices.layer, { excludeTestServices: true })((test) => {
	test.effect(
		"compiles scripts and reports author type errors from one warm worker",
		() =>
			Effect.gen(function* () {
				const compiler = yield* makeSandboxCompilerSupervisor({ workerPath });

				const compiled = yield* compiler.compile(SANDBOX_COMPILER_WARM_UP_SOURCE);
				expect(compiled.manifest).toMatchObject({
					slug: "compiler-warm-up",
					capabilities: ["invokeCapability"],
				});
				const failure = yield* compiler
					.compile(`${SANDBOX_COMPILER_WARM_UP_SOURCE}\nconst count: number = "one";`)
					.pipe(Effect.flip);
				expect(failure).toMatchObject({
					_tag: "PluginBackendCompilerFailure",
					diagnostics: [objectContaining({ line: 6, code: "TS2322", file: "script.ts" })],
				});
				expect((yield* compiler.compile(SANDBOX_COMPILER_WARM_UP_SOURCE)).javascript).toBe(
					compiled.javascript,
				);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"verifies the compiler's SDK and dependency types",
		() =>
			Effect.gen(function* () {
				const compiler = yield* makeSandboxCompilerSupervisor({
					workerPath,
					verifyEnvironment: true,
				});

				const compiled = yield* compiler.compile(SANDBOX_COMPILER_WARM_UP_SOURCE);
				expect(compiled.manifest.slug).toBe("compiler-warm-up");
			}).pipe(Effect.scoped),
		testTimeout,
	);
});
