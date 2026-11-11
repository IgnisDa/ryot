import { expect, test } from "bun:test";

import { BunFileSystem } from "@effect/platform-bun";
import { Effect, Exit, FileSystem, Layer, Schema, type Scope } from "effect";

import { testWorkers } from "./runner.js";

const encodeString = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem>) =>
	Effect.runPromise(
		Effect.scoped(
			Effect.flatMap(Layer.build(BunFileSystem.layer), (context) =>
				Effect.provide(effect, context),
			),
		),
	);

const runClient = Effect.fn(function* (
	files: Readonly<Record<string, string>>,
	args: ReadonlyArray<string> = [],
	entry?: string,
) {
	const fs = yield* FileSystem.FileSystem;
	const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-test-runner-" });
	for (const [name, source] of Object.entries(files)) {
		yield* fs.writeFileString(`${directory}/${name}`, source);
	}
	const child = yield* Effect.acquireRelease(
		Effect.sync(() =>
			Bun.spawn(
				[
					process.execPath,
					entry === undefined
						? Bun.fileURLToPath(new URL("./run-client-tests.ts", import.meta.url))
						: `${directory}/${entry}`,
					...args,
				],
				{ cwd: directory, stdout: "pipe", stderr: "pipe" },
			),
		),
		(process) =>
			Effect.gen(function* () {
				if (process.exitCode === null) {
					process.kill();
				}
				yield* Effect.promise(() => process.exited);
			}),
	);
	const [exitCode, stdout, stderr] = yield* Effect.all([
		Effect.promise(() => child.exited),
		Effect.promise(() => new Response(child.stdout).text()),
		Effect.promise(() => new Response(child.stderr).text()),
	]);
	return { exitCode, output: stdout + stderr };
});

const fixtures = {
	"node.test.ts": `import { expect, test } from "bun:test";
test("node environment", () => expect(typeof document).toBe("undefined"));`,
	"second.test.tsx": `import { afterAll, expect, test } from "bun:test";
test("second DOM environment", () => {
  expect(document.body.tagName).toBe("BODY");
  expect(Reflect.get(globalThis, "runnerMarker")).toBeUndefined();
});
afterAll(() => expect(document.body.tagName).toBe("BODY"));`,
	"first.test.tsx": `import { expect, test } from "bun:test";
test("first DOM environment", () => {
  expect(document.body.tagName).toBe("BODY");
  expect(Reflect.get(globalThis, "runnerMarker")).toBeUndefined();
  Reflect.set(globalThis, "runnerMarker", true);
  const controller = new window.AbortController();
  let calls = 0;
  document.addEventListener("runner-event", () => { calls += 1; }, { signal: controller.signal });
  document.dispatchEvent(new Event("runner-event"));
  controller.abort();
  document.dispatchEvent(new Event("runner-event"));
  expect(calls).toBe(1);
  window.dispatchEvent(new PageTransitionEvent("pageshow"));
});
test("native host cancellation", async () => {
  const controller = new AbortController();
  const request = new Request("http://127.0.0.1/", { signal: controller.signal });
  controller.abort();
  expect(request.signal.aborted).toBe(true);
  let aborted = false;
  try {
    await fetch(request);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("name", "AbortError");
    aborted = true;
  }
  expect(aborted).toBe(true);
  const channel = new MessageChannel();
  try {
    const received = new Promise((resolve) => {
      const lifetime = new AbortController();
      channel.port1.addEventListener("message", (event) => resolve(event.data), { signal: lifetime.signal });
      channel.port1.start();
    });
    channel.port2.postMessage("native port");
    expect(await received).toBe("native port");
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
});`,
};

test("routes files to isolated node and DOM environments", () =>
	run(
		Effect.gen(function* () {
			const result = yield* runClient(fixtures);
			expect(result.exitCode, result.output).toBe(0);
			expect(result.output).toContain("node environment");
			expect(result.output).toContain("first DOM environment");
			expect(result.output).toContain("second DOM environment");
		}),
	));

test("applies file filters without loading the other environment", () =>
	run(
		Effect.gen(function* () {
			const result = yield* runClient(fixtures, ["./node.test.ts", "--timeout=1000", "--bail"]);
			expect(result.exitCode, result.output).toBe(0);
			expect(result.output).toContain("node environment");
			expect(result.output).not.toContain("DOM environment");
		}),
	));

test("propagates test failures and rejects unmatched file filters", () =>
	run(
		Effect.gen(function* () {
			const failure = yield* runClient({
				"failure.test.ts": `import { expect, test } from "bun:test";
test("intentional failure", () => expect(false).toBe(true));`,
			});
			expect(failure.exitCode).not.toBe(0);
			expect(failure.output).toContain("intentional failure");
			const missing = yield* runClient(fixtures, ["missing.test.ts"]);
			expect(missing.exitCode).not.toBe(0);
			expect(missing.output).toContain("No matching test files");
			const invalid = yield* runClient(fixtures, ["--timeout=-1"]);
			expect(invalid.exitCode).not.toBe(0);
			expect(invalid.output).not.toContain("node environment");
		}),
	));

test("runs Effect finalizers when the configured default timeout expires", () =>
	run(
		Effect.gen(function* () {
			const framework = yield* encodeString(import.meta.resolve("@voila.dev/effect-bun-test"));
			const effect = yield* encodeString(import.meta.resolve("effect"));
			const timeout = yield* encodeString(import.meta.resolve("./test-timeout.ts"));
			const result = yield* runClient(
				{
					"timeout.test.ts": `import { expect, test } from "bun:test";
import { it } from ${framework};
import { Effect } from ${effect};
import { testTimeout } from ${timeout};
let released = false;
it.live("default timeout", () => Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.sync(() => { released = true; }));
  yield* Effect.never;
}), testTimeout);
test("default timeout finalizer", () => expect(released).toBe(true));
it.live("explicit test budget", () => Effect.sleep("80 millis"), 500);`,
				},
				["--timeout=50"],
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("(pass) default timeout finalizer");
			expect(result.output).toContain("(pass) explicit test budget");
			const disabled = yield* runClient(
				{
					"disabled.test.ts": `import { it } from ${framework};
import { Effect } from ${effect};
import { testTimeout } from ${timeout};
it.live("disabled default budget", () => Effect.sleep("10 millis"), testTimeout);`,
				},
				["--timeout=0"],
			);
			expect(disabled.exitCode, disabled.output).toBe(0);
		}),
	));

test("resolves the worker count from the last parallel flag", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* testWorkers(4, ["--timeout=10"])).toBe(4);
			expect(yield* testWorkers(4, ["--parallel=2", "--parallel=6"])).toBe(6);
			expect(yield* testWorkers(4, ["--parallel"])).toBe(navigator.hardwareConcurrency);
			expect(Exit.isFailure(yield* Effect.exit(testWorkers(4, ["--parallel=0"])))).toBe(true);
		}),
	));

test("importing the client runner leaves test discovery and execution deferred", () =>
	run(
		Effect.gen(function* () {
			const modulePath = yield* encodeString(
				Bun.fileURLToPath(new URL("./run-client-tests.ts", import.meta.url)),
			);
			const result = yield* runClient(
				{ "entry.ts": `await import(${modulePath}); console.log("import-only");` },
				[],
				"entry.ts",
			);
			expect(result.exitCode).toBe(0);
			expect(result.output.trim()).toBe("import-only");
		}),
	));

test("client runner forwards supplied environment to node and DOM files", () =>
	run(
		Effect.gen(function* () {
			const modulePath = yield* encodeString(
				Bun.fileURLToPath(new URL("./run-client-tests.ts", import.meta.url)),
			);
			const effectPath = yield* encodeString(import.meta.resolve("effect"));
			const result = yield* runClient(
				{
					"node.test.ts": `import { test, expect } from "bun:test"; test("node forwarded", () => { expect(process.env.RYOT_RUNNER_MARKER).toBe("forwarded"); expect(typeof document).toBe("undefined"); });`,
					"dom.test.tsx": `import { test, expect } from "bun:test"; test("DOM forwarded", () => { expect(process.env.RYOT_RUNNER_MARKER).toBe("forwarded"); expect(document.body.tagName).toBe("BODY"); });`,
					"entry.ts": `import { runClientTests } from ${modulePath}; import { Effect } from ${effectPath}; await Effect.runPromise(runClientTests({ env: { RYOT_RUNNER_MARKER: "forwarded" }, workers: 1 }));`,
				},
				[],
				"entry.ts",
			);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("node forwarded");
			expect(result.output).toContain("DOM forwarded");
		}),
	));
