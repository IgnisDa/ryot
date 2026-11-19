import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { makeClientCompilerSupervisor } from "./supervisor";
import { CLIENT_COMPILER_WARM_UP_INPUT } from "./warm-up";

const workerPath = Bun.fileURLToPath(new URL("./worker.ts", import.meta.url));

const page = (source: string) => ({
	...CLIENT_COMPILER_WARM_UP_INPUT,
	files: { "client/index.tsx": new TextEncoder().encode(source) },
});

layer(BunServices.layer, { excludeTestServices: true })((test) => {
	test.effect(
		"compiles pages and reports author type errors from one warm worker",
		() =>
			Effect.gen(function* () {
				const compiler = yield* makeClientCompilerSupervisor({ workerPath });
				const valid = page(
					'export default function Page() { return <p className="bg-accent">Page</p>; }',
				);

				const artifact = yield* compiler.compile(valid);
				expect(artifact.kind).toBe("page");
				const names = artifact.files.map(({ name }) => name);
				expect(names).toContain("module.js");
				expect(names).toContain("module.css");
				const failure = yield* compiler
					.compile(
						page("const count: number = 'one';\nexport default function Page() { return null; }"),
					)
					.pipe(Effect.flip);
				expect(failure).toMatchObject({
					_tag: "PluginClientCompilerFailure",
					diagnostics: [objectContaining({ line: 1, code: "TS2322", file: "client/index.tsx" })],
				});
				expect((yield* compiler.compile(valid)).hash).toBe(artifact.hash);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"verifies the compiler's SDK and dependency types",
		() =>
			Effect.gen(function* () {
				const compiler = yield* makeClientCompilerSupervisor({
					workerPath,
					verifyEnvironment: true,
				});

				expect((yield* compiler.compile(CLIENT_COMPILER_WARM_UP_INPUT)).kind).toBe("page");
			}).pipe(Effect.scoped),
		testTimeout,
	);
});
