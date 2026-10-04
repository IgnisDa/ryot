import { assert, expect, it } from "@effect/vitest";
import { Result } from "effect";

import { finalizeCompiledManifest } from "./compiler-metadata";
import { jsonByteLength, SANDBOX_COMPILER_LIMITS } from "./limits";

const sourceMetadata = {
	capabilities: [],
	oauthConnectionFields: [],
	executableDependencies: [],
	optionalPluginConfigKeys: [],
	requiredPluginConfigKeys: [],
};
const runtimeImports = ["@ryot-app/sandbox-sdk/fflate"];

const finalize = (name: string, imports: ReadonlyArray<string>) =>
	finalizeCompiledManifest(
		{ name, slug: "entry", kind: "script" },
		{ ...sourceMetadata, runtimeImports: imports },
	);

it("applies the manifest size cap after adding runtime imports", () => {
	const withImports = finalize("", runtimeImports);
	assert(Result.isSuccess(withImports));
	const baseBytes = jsonByteLength(withImports.success);
	assert(baseBytes !== null);
	const name = "n".repeat(SANDBOX_COMPILER_LIMITS.manifestBytes - baseBytes + 1);
	const fitting = finalize(name, []);
	assert(Result.isSuccess(fitting));
	expect(jsonByteLength(fitting.success)).toBeLessThanOrEqual(
		SANDBOX_COMPILER_LIMITS.manifestBytes,
	);
	const oversized = finalize(name, runtimeImports);
	assert(Result.isFailure(oversized));
	expect(oversized.failure.code).toBe("RYOT_MANIFEST_SIZE");
});

it("rejects unsorted or duplicate runtime imports", () => {
	for (const imports of [
		["@ryot-app/sandbox-sdk/youtubei", "@ryot-app/sandbox-sdk/fflate"],
		["@ryot-app/sandbox-sdk/fflate", "@ryot-app/sandbox-sdk/fflate"],
	]) {
		const result = finalize("Entry", imports);
		assert(Result.isFailure(result));
		expect(result.failure.code).toBe("RYOT_METADATA");
	}
});
