import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { collectViteOutputs } from "./index";
import type { ViteCompilerError } from "./index";

const errorReason = <Value>(result: Result.Result<Value, ViteCompilerError>) =>
	Result.isFailure(result) ? result.failure.reason : undefined;

describe("Vite output", () => {
	it.effect("collects result arrays as copied bytes in deterministic path order", () =>
		Effect.sync(() => {
			const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
			const collected = collectViteOutputs([
				{
					output: [
						{ type: "asset", source: "<svg/>", fileName: "assets/icon.svg" },
						{ type: "asset", source: imageBytes, fileName: "assets/icon.png" },
					],
				},
				{ output: [{ type: "chunk", code: "export {};", fileName: "assets/app.js" }] },
			]);
			expect(Result.isSuccess(collected)).toBe(true);
			if (Result.isFailure(collected)) {
				return;
			}
			imageBytes.fill(0);
			expect(collected.success.map(({ path, contentType }) => [path, contentType])).toEqual([
				["assets/app.js", "text/javascript; charset=utf-8"],
				["assets/icon.png", "image/png"],
				["assets/icon.svg", "image/svg+xml"],
			]);
			expect(collected.success[1]?.bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
		}),
	);

	it.effect("returns tagged failures for escaping and duplicate output paths", () =>
		Effect.sync(() => {
			expect(
				errorReason(
					collectViteOutputs({ output: [{ source: "", type: "asset", fileName: "../escape.js" }] }),
				),
			).toBe("invalid-output");
			expect(
				errorReason(
					collectViteOutputs([
						{ output: [{ type: "asset", source: "first", fileName: "same.js" }] },
						{ output: [{ type: "asset", source: "second", fileName: "same.js" }] },
					]),
				),
			).toBe("invalid-output");
		}),
	);
});
