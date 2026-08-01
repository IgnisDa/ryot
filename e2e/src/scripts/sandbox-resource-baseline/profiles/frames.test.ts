import { describe, expect, it } from "~/support/effect-test";

import { categorizeJscFrame, categorizeV8Frame, sanitizeFunctionName } from "./frames";

describe("categorizeV8Frame", () => {
	it.each([
		["", "(garbage collector)", "gc"],
		["", "(idle)", "idle"],
		["", "(program)", "program"],
		["", "JSONParse", "native"],
		["ext:core/01_core.js", "op", "deno-internal"],
		["node:buffer", "from", "deno-internal"],
		["file:///tmp/ryot-sandbox-runner-Xk2p9a/runner.mjs", "main", "runner"],
		["file:///build/sandbox-runtime/runner-source.sandbox.ts", "main", "runner"],
		["ryot:external/effect/dist/internal/effect.js", "gen", "runner-dependency:effect"],
		[`file:///var/ryot/deno/exec-1/${"ab12".repeat(16)}.mjs`, "run", "script-module"],
		[
			"file:///var/ryot/deno/runtime-v3-effect-4.0.0-rc.116_youtubei.js-17.0.0-0f0f/youtubei.js-17.0.0.mjs",
			"parse",
			"dependency:youtubei.js-17.0.0",
		],
		[
			"file:///var/ryot/deno/runtime-v3-x-1a/effect-4.0.0-rc.116.mjs",
			"gen",
			"dependency:effect-4.0.0-rc.116",
		],
		["file:///home/ryot/notes/leak.mjs", "run", "other"],
		["https://music.youtube.com/s/player.js", "run", "other"],
	])("categorizes %s (%s) as %s", (url, name, category) => {
		expect(categorizeV8Frame(url, name)).toBe(category);
	});
});

describe("categorizeJscFrame", () => {
	it.each([
		[undefined, false, "native"],
		["node:events", false, "bun-builtin"],
		["/home/ryot/src/anything.ts", true, "bun-builtin"],
		[
			"/home/ryot/node_modules/.bun/effect@4/node_modules/effect/dist/Effect.js",
			false,
			"dependency:effect",
		],
		["/home/ryot/node_modules/@effect/platform/dist/x.js", false, "dependency:@effect/platform"],
		["/home/ryot/dist/server.js", false, "backend-dist"],
		["/tmp/eval-1.js", false, "other"],
	])("categorizes %s (builtin %s) as %s", (sourceUrl, builtin, category) => {
		expect(categorizeJscFrame(sourceUrl, builtin)).toBe(category);
	});
});

describe("sanitizeFunctionName", () => {
	it.each([
		["", "(anonymous)"],
		["(garbage collector)", "(garbage collector)"],
		["parseResponse", "parseResponse"],
		["$_private2", "$_private2"],
		["get https://music.youtube.com", "<redacted-name>"],
		["dQw4w9WgXcQ.title", "<redacted-name>"],
		[`fn${"a".repeat(80)}`, "<redacted-name>"],
		["cache_0123456789abcdef0123", "<redacted-name>"],
	])("maps %s to %s", (name, sanitized) => {
		expect(sanitizeFunctionName(name)).toBe(sanitized);
	});
});
