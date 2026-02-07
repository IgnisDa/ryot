export type SpawnedProcess = Bun.Subprocess<"pipe", "pipe", "pipe">;

export class ProcessPool {
	private readonly idle: SpawnedProcess[] = [];

	constructor(
		private readonly capacity: number,
		private readonly spawnFn: () => SpawnedProcess,
	) {}

	fill() {
		for (let i = 0; i < this.capacity; i++) {
			this.addOne();
		}
	}

	checkout(): SpawnedProcess | null {
		this.pruneExited();
		const proc = this.idle.shift() ?? null;
		if (proc !== null) {
			this.replenish();
		}
		return proc;
	}

	drain() {
		for (const proc of this.idle) {
			try {
				proc.kill("SIGKILL");
			} catch {}
		}
		this.idle.length = 0;
	}

	idleCount(): number {
		this.pruneExited();
		return this.idle.length;
	}

	private pruneExited() {
		let i = 0;
		while (i < this.idle.length) {
			const p = this.idle[i];
			if (!p || p.exitCode !== null || p.signalCode !== null) {
				this.idle.splice(i, 1);
			} else {
				i++;
			}
		}
	}

	private replenish() {
		if (this.idle.length < this.capacity) {
			this.addOne();
		}
	}

	private addOne() {
		try {
			const proc = this.spawnFn();
			this.idle.push(proc);
		} catch {
			// spawn failure is non-fatal; pool replenishes on next checkout
		}
	}
}
