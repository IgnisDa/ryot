import { BunPath } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	detectRuntimeCycles,
	extractImportEdges,
	formatRuntimeCycleDiagnostics,
	type ModuleEdge,
} from "./runtime-module-analysis";

describe("runtime module analysis", () => {
	it.effect("extracts alias and relative module edges from runtime imports", () =>
		Effect.gen(function* () {
			const edges = yield* extractImportEdges(
				{
					path: "/repo/src/modules/alpha/service.ts",
					kind: "runtime",
					content: `
						import { beta } from "#modules/beta/service";
						export type { Gamma } from "../gamma/schema";
						const delta = import("#modules/delta/service");
						import "effect";
						import "./local";
					`,
					moduleName: "alpha",
				},
				"/repo/src/modules",
				new Set(["alpha", "beta", "delta", "gamma"]),
			).pipe(Effect.provide(BunPath.layer));

			expect(edges).toEqual([
				{ to: "beta", from: "alpha", kind: "runtime" },
				{ to: "delta", from: "alpha", kind: "runtime" },
				{ to: "gamma", from: "alpha", kind: "runtime" },
			]);
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
