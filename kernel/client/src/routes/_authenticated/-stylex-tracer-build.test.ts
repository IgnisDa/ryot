import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const clientRoot = process.cwd();

const build = (output: string, enabled: boolean) => {
	const environment = { ...process.env };
	if (enabled) {
		environment.RYOT_STYLEX_TRACER = "1";
	} else {
		delete environment.RYOT_STYLEX_TRACER;
	}
	const result = spawnSync(process.execPath, ["run", "vite", "build", "--outDir", output], {
		cwd: clientRoot,
		encoding: "utf8",
		env: environment,
	});
	expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
};

const artifacts = (directory: string) => {
	const paths: string[] = [];
	const collect = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) {
				collect(path);
			} else {
				paths.push(path);
			}
		}
	};
	collect(directory);
	return {
		names: paths.map((path) => path.slice(directory.length + 1)),
		text: paths
			.filter((path) => /\.(?:css|html|js)$/.test(path))
			.map((path) => readFileSync(path, "utf8"))
			.join("\n"),
	};
};

describe("StyleX tracer production artifacts", () => {
	it("eliminates the tracer screen and CSS unless the build explicitly opts in", () => {
		const root = mkdtempSync(join(tmpdir(), "ryot-stylex-tracer-build-"));
		try {
			const ordinaryDirectory = join(root, "ordinary");
			const optInDirectory = join(root, "opt-in");
			build(ordinaryDirectory, false);
			build(optInDirectory, true);

			const ordinary = artifacts(ordinaryDirectory);
			expect(ordinary.names.some((name) => name.includes("stylex-tracer-screen"))).toBe(false);
			expect(ordinary.text).not.toContain("stylex-tracer-screen");
			expect(ordinary.text).not.toContain("ryot-stylex-tracer");

			const optIn = artifacts(optInDirectory);
			expect(optIn.names.some((name) => name.includes("stylex-tracer-screen"))).toBe(true);
			expect(optIn.text).toContain("stylex-tracer-screen");
			expect(optIn.text).toContain("ryot-stylex-tracer");
		} finally {
			rmSync(root, { force: true, recursive: true });
		}
	}, 120_000);
});
