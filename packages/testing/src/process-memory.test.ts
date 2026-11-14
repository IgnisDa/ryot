import { expect } from "bun:test";

import { it } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";

import { captureTestProcess } from "./process.js";

it.live("measures a workload's resident memory without charging its parent's allocation", () =>
	Effect.gen(function* () {
		const encodeString = Schema.encodeEffect(Schema.fromJsonString(Schema.String));
		const effectPath = yield* encodeString(import.meta.resolve("effect"));
		const platformPath = yield* encodeString(import.meta.resolve("@effect/platform-bun"));
		const memoryPath = yield* encodeString(import.meta.resolve("./process-memory.ts"));
		const retained = Buffer.alloc(256 * 1024 * 1024, 1);
		const result = yield* captureTestProcess({
			args: [
				"--eval",
				`import assert from "node:assert/strict";
import { Effect } from ${effectPath};
import { BunFileSystem } from ${platformPath};
import { reportProcessMemory } from ${memoryPath};
const retained = Buffer.alloc(32 * 1024 * 1024, 1);
const memory = await Effect.runPromise(reportProcessMemory("allocated").pipe(Effect.provide(BunFileSystem.layer)));
assert.ok(memory.peakRssBytes >= retained.byteLength);
assert.ok(memory.peakRssBytes < 256 * 1024 * 1024);
assert.equal(retained[0], 1);`,
			],
		});
		expect(result.exitCode, result.output).toBe(0);
		expect(retained[0]).toBe(1);
	}),
);
