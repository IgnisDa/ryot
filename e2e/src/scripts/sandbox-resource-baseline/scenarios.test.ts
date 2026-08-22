import { describe, expect, it } from "~/support/effect-test";

import {
	ALL_SCENARIOS,
	CONCURRENCY_CANDIDATES,
	counterbalancedOrder,
	findScenario,
} from "./scenarios";

describe("counterbalancedOrder", () => {
	it("places every concurrency once per round and once in each position across four rounds", () => {
		const rounds = counterbalancedOrder([...CONCURRENCY_CANDIDATES], 4);

		for (const round of rounds) {
			expect([...round].sort((left, right) => left - right)).toEqual([...CONCURRENCY_CANDIDATES]);
		}
		for (const position of [0, 1, 2, 3]) {
			expect(
				rounds.map((round) => round[position]).sort((left, right) => (left ?? 0) - (right ?? 0)),
			).toEqual([...CONCURRENCY_CANDIDATES]);
		}
	});

	it("covers every ordered adjacent pair exactly once in the first four rounds", () => {
		const pairs = counterbalancedOrder([...CONCURRENCY_CANDIDATES], 4).flatMap((round) =>
			round.slice(1).map((value, index) => `${round[index]}->${value}`),
		);

		expect(new Set(pairs).size).toBe(pairs.length);
		expect(pairs).toHaveLength(12);
	});

	it("reverses the first round for a fifth round rather than repeating it", () => {
		const rounds = counterbalancedOrder([...CONCURRENCY_CANDIDATES], 5);

		expect(rounds[4]).toEqual(rounds[0]?.toReversed());
	});
});

describe("scenario definitions", () => {
	it("keeps scenario ids unique and resolvable", () => {
		const ids = ALL_SCENARIOS.map(({ id }) => id);

		expect(new Set(ids).size).toBe(ids.length);
		expect(findScenario("hermetic-c3").workerConcurrency).toBe(3);
		expect(findScenario("soak-live-details").waves).toBe(10);
		expect(() => findScenario("missing")).toThrow("Unknown scenario missing");
	});
});
