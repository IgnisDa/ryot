import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { Effect, Schema } from "effect";
import { assert, expect, it } from "vitest";

import { SandboxCompiler, type CompiledSandboxModule } from "#modules/sandbox/compiler";

const source = `
import { defineDriver, defineManifest, defineScript, z } from "@ryot/sandbox-sdk";

export const manifest = defineManifest({
  kind: "script",
  name: "Runner validation",
  slug: "runner-validation",
  capabilities: [],
  requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
  input: z.object({ value: z.number() }),
  output: z.number(),
  run: async (input) => input.value,
});

const invalidOutput = defineDriver(manifest, {
  input: z.object({}),
  output: z.number(),
  run: async () => "wrong" as never,
});

export default defineScript({ manifest, drivers: { main, invalidOutput } });
`;

const encodeRunnerRequest = Schema.encodeSync(Schema.parseJson(Schema.Unknown));
const decodeRunnerResponse = Schema.decodeUnknownSync(Schema.parseJson(Schema.Unknown));
type RunnerCompiledModule = Omit<CompiledSandboxModule, "format"> & { readonly format: number };

const runInDeno = (compiled: RunnerCompiledModule, driverName: string, context: unknown) =>
	Effect.gen(function* () {
		const runnerPath = Bun.fileURLToPath(new URL("./runner-source.sandbox.js", import.meta.url));
		const process = Bun.spawn(
			[
				"deno",
				"run",
				"--deny-run",
				"--deny-env",
				"--deny-ffi",
				"--deny-write",
				"--no-prompt",
				"--no-remote",
				"--cached-only",
				`--allow-read=${runnerPath}`,
				runnerPath,
			],
			{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
		);
		const request = `${encodeRunnerRequest({
			context,
			driverName,
			token: "unused",
			apiFunctions: [],
			scriptId: "script-1",
			executionId: "execution-1",
			metadata: compiled.manifest,
			apiBase: "http://127.0.0.1:1",
			compiledFormat: compiled.format,
			compiledCode: compiled.javascript,
		})}\n`;
		yield* Effect.tryPromise({
			try: () => Promise.resolve(process.stdin.write(request)).then(() => process.stdin.end()),
			catch: (error) => new SandboxRunError({ message: unknownToMessage(error) }),
		});

		const [stdout, stderr, exitCode] = yield* Effect.tryPromise({
			try: () =>
				Promise.all([
					new Response(process.stdout).text(),
					new Response(process.stderr).text(),
					process.exited,
				]),
			catch: (error) => new SandboxRunError({ message: unknownToMessage(error) }),
		});
		expect(exitCode, stderr).toBe(0);

		return yield* Effect.try({
			try: () => decodeRunnerResponse(stdout.trim()),
			catch: (error) => new SandboxRunError({ message: unknownToMessage(error) }),
		});
	});

it("loads compiled ESM in Deno and validates driver input and output", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(source);

			const success = yield* runInDeno(compiled, "main", { value: 42 });
			assert(success !== null && typeof success === "object");
			expect(success).toMatchObject({ success: true, value: 42 });

			const invalidInput = yield* runInDeno(compiled, "main", { value: "wrong" });
			assert(invalidInput !== null && typeof invalidInput === "object");
			expect(Reflect.get(invalidInput, "error")).toContain("Driver input validation failed");

			const invalidOutput = yield* runInDeno(compiled, "invalidOutput", {});
			assert(invalidOutput !== null && typeof invalidOutput === "object");
			expect(Reflect.get(invalidOutput, "error")).toContain("Driver output validation failed");

			const unsupported = yield* runInDeno({ ...compiled, format: 2 }, "main", {
				value: 42,
			});
			assert(unsupported !== null && typeof unsupported === "object");
			expect(Reflect.get(unsupported, "error")).toBe("Unsupported sandbox compiled format: 2");
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));
