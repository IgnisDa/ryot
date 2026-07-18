import { BunServices, BunPath } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
	analyzeRuntimeModules,
	detectRuntimeCycles,
	extractImportEdges,
	formatRuntimeCycleDiagnostics,
	type ModuleEdge,
} from "./runtime-module-analysis";

const analyzeSources = (sources: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-runtime-modules-" });
		const srcDir = path.join(root, "src");

		for (const [relativePath, content] of Object.entries(sources).sort(([left], [right]) =>
			left.localeCompare(right),
		)) {
			const file = path.join(srcDir, relativePath);
			yield* fs.makeDirectory(path.dirname(file), { recursive: true });
			yield* fs.writeFileString(file, content);
		}

		return yield* analyzeRuntimeModules(path.join(srcDir, "modules"));
	}).pipe(Effect.provide(BunServices.layer));

describe("runtime module analysis", () => {
	it.effect("extracts alias and relative runtime imports but ignores type-only imports", () =>
		Effect.gen(function* () {
			const edges = yield* extractImportEdges(
				{
					kind: "runtime",
					moduleName: "alpha",
					path: "/repo/src/modules/alpha/service.ts",
					content: `
						import { beta } from "#modules/beta/service";
						export type { Gamma } from "../gamma/schema";
						const delta = import("#modules/delta/service");
						import { zeta } from "../zeta/service";
						import "effect";
						import "./local";
					`,
				},
				"/repo/src/modules",
				new Set(["alpha", "beta", "delta", "gamma", "zeta"]),
			).pipe(Effect.provide(BunPath.layer));

			expect(edges).toEqual([
				{ to: "beta", from: "alpha", kind: "runtime" },
				{ to: "delta", from: "alpha", kind: "runtime" },
				{ to: "zeta", from: "alpha", kind: "runtime" },
			]);
		}),
	);

	it.effect("detects an existing direct module cycle", () =>
		Effect.gen(function* () {
			const cycles = yield* analyzeSources({
				"modules/beta/service.ts": 'import "../alpha/service";',
				"modules/alpha/service.ts": 'import "#modules/beta/service";',
			});

			expect(cycles).toEqual([["alpha", "beta", "alpha"]]);
		}),
	);

	it.effect("detects a cycle through backend lib runtime files", () =>
		Effect.gen(function* () {
			const cycles = yield* analyzeSources({
				"modules/alpha/service.ts": 'import "#lib/bridge";',
				"lib/bridge.ts": 'import "../modules/beta/service";',
				"modules/beta/service.ts": 'import "#modules/alpha/service";',
			});

			expect(cycles).toEqual([["alpha", "beta", "alpha"]]);
		}),
	);

	it.effect("accepts an acyclic dependency through backend app runtime files", () =>
		Effect.gen(function* () {
			const cycles = yield* analyzeSources({
				"modules/alpha/service.ts": 'import "#app/bridge";',
				"app/bridge.ts": 'import "../modules/beta/service";',
				"modules/beta/service.ts": "export const beta = true;",
			});

			expect(cycles).toEqual([]);
		}),
	);

	it("reports exact cycle paths deterministically and ignores test edges", () => {
		const edges: ModuleEdge[] = [
			{ to: "beta", from: "zeta", kind: "runtime" },
			{ to: "alpha", from: "beta", kind: "runtime" },
			{ to: "zeta", from: "alpha", kind: "runtime" },
			{ to: "beta", from: "alpha", kind: "test" },
		];
		const cycles = detectRuntimeCycles(["zeta", "beta", "alpha"], edges.toReversed());

		expect(formatRuntimeCycleDiagnostics(cycles)).toBe(
			"Runtime module cycles detected:\n- alpha -> zeta -> beta -> alpha",
		);
	});
});
