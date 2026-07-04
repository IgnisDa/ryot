import { extname } from "node:path";

import { Predicate, Result } from "effect";

import { viteCompilerError } from "./error";
import type { ViteCompilerError } from "./error";
import { validateRelativePath } from "./workspace";

export interface CollectedViteFile {
	readonly path: string;
	readonly bytes: Uint8Array;
	readonly contentType: string;
}

const contentTypes: Readonly<Record<string, string>> = {
	".otf": "font/otf",
	".ttf": "font/ttf",
	".gif": "image/gif",
	".png": "image/png",
	".jpg": "image/jpeg",
	".woff": "font/woff",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
	".css": "text/css; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".json": "application/json; charset=utf-8",
};

const inferContentType = (path: string) =>
	contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream";

export const collectViteOutputs = (
	result: unknown,
): Result.Result<readonly CollectedViteFile[], ViteCompilerError> => {
	const outputs = Array.isArray(result) ? result : [result];
	const files: CollectedViteFile[] = [];
	const seen = new Set<string>();
	for (const output of outputs) {
		if (!Predicate.isObject(output) || !("output" in output) || !Array.isArray(output["output"])) {
			return Result.fail(
				viteCompilerError("invalid-output", "Vite build result is not collectable output"),
			);
		}
		for (const item of output["output"]) {
			if (!Predicate.isObject(item) || !("fileName" in item)) {
				return Result.fail(
					viteCompilerError("invalid-output", "Vite emitted an unsupported output item"),
				);
			}
			const validatedPath = validateRelativePath(item["fileName"]);
			if (Result.isFailure(validatedPath)) {
				return Result.fail(
					viteCompilerError("invalid-output", validatedPath.failure.message, validatedPath.failure),
				);
			}
			const path = validatedPath.success;
			if (seen.has(path)) {
				return Result.fail(
					viteCompilerError("invalid-output", `Vite emitted a duplicate output path: ${path}`),
				);
			}
			seen.add(path);
			let bytes: Uint8Array;
			if (item["type"] === "chunk" && typeof item["code"] === "string") {
				bytes = new TextEncoder().encode(item["code"]);
			} else if (item["type"] === "asset" && typeof item["source"] === "string") {
				bytes = new TextEncoder().encode(item["source"]);
			} else if (item["type"] === "asset" && item["source"] instanceof Uint8Array) {
				bytes = item["source"].slice();
			} else {
				return Result.fail(
					viteCompilerError("invalid-output", `Vite emitted unsupported output: ${path}`),
				);
			}
			files.push({ path, bytes, contentType: inferContentType(path) });
		}
	}
	files.sort(({ path: left }, { path: right }) => {
		if (left < right) {
			return -1;
		}
		if (left > right) {
			return 1;
		}
		return 0;
	});
	return Result.succeed(files);
};
