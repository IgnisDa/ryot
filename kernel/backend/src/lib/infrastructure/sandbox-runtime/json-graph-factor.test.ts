import { describe, expect, it } from "vitest";

import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";

describe("json graph factor", () => {
	it("json_graph_factor_bounds_pathological_decode_paths", () => {
		// A fresh process keeps unrelated test-runner garbage out of the heap measurement.
		const measured = Bun.spawnSync([
			process.execPath,
			new URL("./json-graph-factor.measure.ts", import.meta.url).pathname,
		]);
		expect(measured.exitCode).toBe(0);
		const factors: Record<string, number> = JSON.parse(measured.stdout.toString());
		for (const factor of Object.values(factors)) {
			expect(factor).toBeGreaterThan(1);
			expect(factor).toBeLessThanOrEqual(SANDBOX_JSON_GRAPH_FACTOR);
		}
	});
});
