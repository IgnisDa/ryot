import { describe, expect, it } from "vitest";

import { SANDBOX_LIMITS } from "./limits";
import { sandboxDenoRunFlags } from "./runtime";

const artifactPath = "/tmp/ryot-artifacts/export.zip";
const scratchDirectory = "/tmp/ryot-sandbox-scratch-abc";
const base = {
	bridgePort: 4242,
	runtimeDirectory: "/tmp/ryot-runtime",
	runnerPath: "/tmp/ryot-runner/runner.mjs",
	importMapPath: "/tmp/ryot-runtime/import-map.json",
};

describe("sandbox deno flag assembly", () => {
	it("keeps the ungranted flags byte for byte", () => {
		expect(sandboxDenoRunFlags(base)).toEqual([
			"--deny-run",
			"--deny-env",
			"--deny-ffi",
			"--deny-write",
			"--no-prompt",
			"--no-config",
			"--no-lock",
			"--no-npm",
			"--no-remote",
			"--cached-only",
			`--v8-flags=--max-old-space-size=${SANDBOX_LIMITS.execution.denoHeapMiB}`,
			"--import-map=/tmp/ryot-runtime/import-map.json",
			"--allow-read=/tmp/ryot-runner/runner.mjs,/tmp/ryot-runtime",
			"--allow-net=127.0.0.1:4242",
		]);
		expect(sandboxDenoRunFlags({ ...base, grants: {} })).toEqual(sandboxDenoRunFlags(base));
	});

	it("extends the read list for an artifact grant without granting writes", () => {
		const flags = sandboxDenoRunFlags({ ...base, grants: { artifactPath } });

		expect(flags).toContain("--deny-write");
		expect(flags).toContain(
			`--allow-read=/tmp/ryot-runner/runner.mjs,/tmp/ryot-runtime,${artifactPath}`,
		);
		expect(flags.filter((flag) => flag.startsWith("--allow-write"))).toEqual([]);
	});

	it("replaces the blanket write denial with a scratch-scoped write and read grant", () => {
		const flags = sandboxDenoRunFlags({ ...base, grants: { scratchDirectory } });

		expect(flags).not.toContain("--deny-write");
		expect(flags[3]).toBe(`--allow-write=${scratchDirectory}`);
		expect(flags).toContain(
			`--allow-read=/tmp/ryot-runner/runner.mjs,/tmp/ryot-runtime,${scratchDirectory}`,
		);
	});

	it("grants both the artifact read and the scratch read-write together", () => {
		expect(sandboxDenoRunFlags({ ...base, grants: { artifactPath, scratchDirectory } })).toEqual([
			"--deny-run",
			"--deny-env",
			"--deny-ffi",
			`--allow-write=${scratchDirectory}`,
			"--no-prompt",
			"--no-config",
			"--no-lock",
			"--no-npm",
			"--no-remote",
			"--cached-only",
			`--v8-flags=--max-old-space-size=${SANDBOX_LIMITS.execution.denoHeapMiB}`,
			"--import-map=/tmp/ryot-runtime/import-map.json",
			`--allow-read=/tmp/ryot-runner/runner.mjs,/tmp/ryot-runtime,${artifactPath},${scratchDirectory}`,
			"--allow-net=127.0.0.1:4242",
		]);
	});
});
