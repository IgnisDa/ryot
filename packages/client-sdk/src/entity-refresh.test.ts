import { afterEach, describe, expect, it, vi } from "vitest";

import { createEntityRefresh } from "./entity-refresh";
import type { EntityUpdate } from "./index";

afterEach(() => {
	vi.useRealTimers();
});

const populated = (entityId: string): EntityUpdate => ({ entityId, reason: "populated" });

describe("createEntityRefresh", () => {
	it("batches and dedupes the hints that land inside one window", async () => {
		vi.useFakeTimers();
		const batches: EntityUpdate[][] = [];
		const refresh = createEntityRefresh((updates) => {
			batches.push([...updates]);
			return Promise.resolve();
		});

		refresh.hint(populated("a"));
		refresh.hint({ entityId: "a", reason: "translated" });
		refresh.hint(populated("b"));
		await vi.advanceTimersByTimeAsync(250);

		expect(batches).toEqual([
			[
				{ entityId: "a", reason: "translated" },
				{ entityId: "b", reason: "populated" },
			],
		]);

		refresh.hint(populated("c"));
		await vi.advanceTimersByTimeAsync(250);
		expect(batches).toHaveLength(2);
		expect(batches[1]).toEqual([populated("c")]);
	});

	it("delivers an empty batch for a hint that carries no update", async () => {
		vi.useFakeTimers();
		const batches: EntityUpdate[][] = [];
		const refresh = createEntityRefresh((updates) => {
			batches.push([...updates]);
			return Promise.resolve();
		});

		refresh.hint();
		await vi.advanceTimersByTimeAsync(250);

		expect(batches).toEqual([[]]);
	});

	it("keeps blocked updates queued and merges them with newer ones", async () => {
		vi.useFakeTimers();
		const batches: EntityUpdate[][] = [];
		const refresh = createEntityRefresh((updates) => {
			batches.push([...updates]);
			return Promise.resolve();
		});

		refresh.block(true);
		refresh.hint(populated("a"));
		await vi.advanceTimersByTimeAsync(1_000);
		expect(batches).toEqual([]);

		refresh.hint(populated("b"));
		refresh.block(false);
		await vi.advanceTimersByTimeAsync(250);

		expect(batches).toEqual([[populated("a"), populated("b")]]);
	});

	it("drops queued work once disposed", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const refresh = createEntityRefresh(() => {
			calls++;
			return Promise.resolve();
		});

		refresh.hint(populated("a"));
		refresh.dispose();
		await vi.advanceTimersByTimeAsync(1_000);

		expect(calls).toBe(0);
	});
});
