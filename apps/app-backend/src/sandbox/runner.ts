import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sandboxRunnerSource from "./scripts/runner-source.txt";

export class RunnerFileManager {
	private runnerPath: string | null = null;

	async create() {
		const fileName = `ryot-sandbox-runner-${Date.now()}-${process.pid}.mjs`;
		this.runnerPath = join(tmpdir(), fileName);
		await writeFile(this.runnerPath, sandboxRunnerSource, "utf8");
	}

	async remove() {
		if (!this.runnerPath) return;
		await rm(this.runnerPath, { force: true });
		this.runnerPath = null;
	}

	getPath() {
		return this.runnerPath;
	}
}
