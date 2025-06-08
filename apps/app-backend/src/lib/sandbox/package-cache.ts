import { $ } from "bun";
import { readStream, waitForExit } from "./utils";

const resolveCacheDir = () =>
	process.env.RYOT_SANDBOX_DENO_DIR ??
	`${process.env.HOME ?? "/root"}/ryot/tmp`;

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

		if (exit.code !== 0) {
			const hasExistingCache = await this.isCachePopulated();
			if (!hasExistingCache) {
				throw new Error(
					`Sandbox package cache population failed (exit ${exit.code}): ${stderr.trim()}`,
				);
			}
			console.warn(
				"Sandbox package cache refresh failed; using existing cache.",
				stderr.trim(),
			);
		}
	}

	private async isCachePopulated() {
		return Bun.file(`${this.cacheDir}/npm`).exists();
	}
}
