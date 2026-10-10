import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { collectViteOutputs } from "./index";
import type { ViteCompilerError } from "./index";

const errorReason = <Value>(result: Result.Result<Value, ViteCompilerError>) =>
	Result.isFailure(result) ? result.failure.reason : undefined;

describe("Vite output", () => {
	it("retains executable BOM, CRLF, and distinct Unicode encodings", () => {
		const code = '\ufeffexport default "e\u0301 é \ufffd 😀";\r\n';
		const result = collectViteOutputs({ output: [{ code, type: "chunk", fileName: "module.js" }] });
		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success[0]?.bytes).toEqual(new TextEncoder().encode(code));
		}
	});

	it("rejects unpaired surrogates before executable bytes can acquire a replacement identity", () => {
		for (const surrogate of ["\ud800", "\udfff"]) {
			for (const item of [
				{ type: "chunk", fileName: "module.js", code: `export default "${surrogate}";` },
				{ type: "asset", source: surrogate, fileName: "module.css" },
				{ type: "asset", source: surrogate, fileName: "module.mjs" },
			]) {
				expect(errorReason(collectViteOutputs({ output: [item] }))).toBe("invalid-output");
			}
		}
	});

	it("collects result arrays as copied bytes in deterministic path order", () => {
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
		expect(
			collected.success.map(({ contentType, path: filePath }) => [filePath, contentType]),
		).toEqual([
			["assets/app.js", "text/javascript; charset=utf-8"],
			["assets/icon.png", "image/png"],
			["assets/icon.svg", "image/svg+xml"],
		]);
		expect(collected.success[1]?.bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
	});

	it("returns tagged failures for escaping and duplicate output paths", () => {
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
	});
});
