import { describe, expect, it } from "bun:test";
import { ProcessPool, type SpawnedProcess } from "./process-pool";

type FakeProcess = {
	killCalls: string[];
	exitCode: number | null;
	signalCode: string | null;
	kill: (signal: string) => void;
};

function makeAlive(): FakeProcess {
	const killCalls: string[] = [];
	return {
		exitCode: null,
		signalCode: null,
		kill(signal) {
			killCalls.push(signal);
		},
		killCalls,
	};
}

function makeExited(exitCode = 0): FakeProcess {
	const killCalls: string[] = [];
	return {
		exitCode,
		signalCode: null,
		kill(signal) {
			killCalls.push(signal);
		},
		killCalls,
	};
}

function asSpawned(p: FakeProcess): SpawnedProcess {
	return p as unknown as SpawnedProcess;
}

describe("ProcessPool.fill", () => {
	it("populates pool to full capacity", () => {
		const pool = new ProcessPool(3, () => asSpawned(makeAlive()));
		pool.fill();
		expect(pool.idleCount()).toBe(3);
	});

	it("is non-fatal when spawnFn throws for one process", () => {
		let callCount = 0;
		const pool = new ProcessPool(3, () => {
			callCount++;
			if (callCount === 2) {
				throw new Error("spawn failed");
			}
			return asSpawned(makeAlive());
		});
		pool.fill();
		expect(pool.idleCount()).toBe(2);
	});
});

describe("ProcessPool.checkout", () => {
	it("returns a process from the pool and replenishes one", () => {
		let spawnCount = 0;
		const pool = new ProcessPool(3, () => {
			spawnCount++;
			return asSpawned(makeAlive());
		});
		pool.fill();
		expect(spawnCount).toBe(3);

		const proc = pool.checkout();
		expect(proc).not.toBeNull();
		expect(spawnCount).toBe(4);
		expect(pool.idleCount()).toBe(3);
	});

	it("returns null when the pool was never filled", () => {
		const pool = new ProcessPool(3, () => asSpawned(makeAlive()));
		expect(pool.checkout()).toBeNull();
	});

	it("skips exited processes and returns the first alive one", () => {
		const exited = makeExited();
		const alive = makeAlive();
		const procs = [exited, alive];
		let idx = 0;
		const pool = new ProcessPool(2, () =>
			asSpawned(procs[idx++] ?? makeAlive()),
		);
		pool.fill();

		const proc = pool.checkout();
		expect(proc).toBe(alive as unknown as SpawnedProcess);
	});

	it("returns null when all pooled processes have exited", () => {
		const procs = [makeExited(), makeExited(), makeExited()];
		let idx = 0;
		const pool = new ProcessPool(3, () =>
			asSpawned(procs[idx++] ?? makeExited()),
		);
		pool.fill();
		expect(pool.checkout()).toBeNull();
	});
});

describe("ProcessPool.drain", () => {
	it("kills all idle processes and empties the pool", () => {
		const procs: FakeProcess[] = [];
		const pool = new ProcessPool(3, () => {
			const p = makeAlive();
			procs.push(p);
			return asSpawned(p);
		});
		pool.fill();
		pool.drain();

		expect(pool.idleCount()).toBe(0);
		for (const p of procs) {
			expect(p.killCalls).toEqual(["SIGKILL"]);
		}
	});

	it("is safe to call on an empty pool", () => {
		const pool = new ProcessPool(3, () => asSpawned(makeAlive()));
		expect(() => pool.drain()).not.toThrow();
		expect(pool.idleCount()).toBe(0);
	});
});
