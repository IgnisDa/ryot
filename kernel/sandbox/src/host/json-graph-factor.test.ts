import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";

describe("json graph factor", () => {
	it.effect("bounds pathological decode paths with the JSON graph factor", () =>
		Effect.gen(function* () {
			// A fresh process keeps unrelated test-runner garbage out of the heap measurement.
			const measured = Bun.spawnSync([
				process.execPath,
				new URL("./json-graph-factor.measure.ts", import.meta.url).pathname,
			]);
			expect(measured.exitCode).toBe(0);
			const factors = yield* Schema.decodeEffect(
				Schema.fromJsonString(Schema.Record(Schema.String, Schema.Finite)),
			)(measured.stdout.toString());
			for (const factor of Object.values(factors)) {
				expect(factor).toBeGreaterThan(1);
				expect(factor).toBeLessThanOrEqual(SANDBOX_JSON_GRAPH_FACTOR);
			}
		}),
	);
});
