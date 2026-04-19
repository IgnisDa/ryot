import { $ } from "bun";

import { readStream, waitForExit } from "./utils";

const resolveCacheDir = () =>
	process.env.RYOT_SANDBOX_DENO_DIR ?? `${process.env.HOME ?? "/root"}/ryot/tmp`;

export class PackageCacheManager {
	private readonly cacheDir = resolveCacheDir();

	getDir() {
		return this.cacheDir;
	}

	async populate(packages: readonly string[]) {
		await $`mkdir -p ${this.cacheDir}`.quiet();

		if (packages.length === 0) {
			return;
		}

		if (await this.isCachePopulated(packages)) {
			return;
		}

		const proc = Bun.spawn(["deno", "cache", "--no-config", ...packages], {
			stderr: "pipe",
			stdout: "pipe",
			env: { DENO_DIR: this.cacheDir, PATH: process.env.PATH },
		});

		const [exit, stderr] = await Promise.all([
			waitForExit(proc),
			readStream(proc.stderr),
			readStream(proc.stdout),
		]);

		if (exit.code === 0) {
			await Bun.write(this.markerPath, packages.join("\n"));
			return;
		}

		if (await Bun.file(this.markerPath).exists()) {
			console.warn("Sandbox package cache refresh failed; using existing cache.", stderr.trim());
			return;
		}

		throw new Error(
			`Sandbox package cache population failed (exit ${exit.code}): ${stderr.trim()}`,
		);
	}

	private get markerPath() {
		return `${this.cacheDir}/.ryot-sandbox-cache-complete`;
	}

	private async isCachePopulated(packages: readonly string[]) {
		const marker = Bun.file(this.markerPath);
		if (!(await marker.exists())) {
			return false;
		}
		return (await marker.text()) === packages.join("\n");
	}
}
