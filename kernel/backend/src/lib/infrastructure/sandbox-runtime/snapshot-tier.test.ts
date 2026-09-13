import { expect, it } from "@effect/vitest";
import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { Result } from "effect";

import { selectSnapshotTier } from "./snapshot-tier";

it("snapshot_routing_uses_smallest_covering_import_set", () => {
	const coreLibraries = new Set(["dependency-runtime", "effect", "filesystem", "ryotql"]);
	const fullLibraries = new Set(["youtubei"]);
	const dataLibraries = new Set(["cheerio", "fflate", "fast-xml-parser", "papaparse"]);
	const tierForName = (name: string): "core" | "data" | "full" => {
		if (fullLibraries.has(name)) {
			return "full";
		}
		if (dataLibraries.has(name)) {
			return "data";
		}
		if (coreLibraries.has(name)) {
			return "core";
		}
		throw new Error(`Unassigned snapshot tier: ${name}`);
	};
	const libraries = SANDBOX_RUNTIME_REGISTRY.map(({ name, aliases, sdkImport }) => ({
		name,
		imports: [sdkImport, ...aliases],
	}));
	for (let mask = 0; mask < 2 ** libraries.length; mask += 1) {
		const selectedLibraries = libraries.filter((_, index) => (mask & (1 << index)) !== 0);
		const runtimeImports = selectedLibraries.flatMap(({ imports }) => imports);
		const selectedTiers = selectedLibraries.map(({ name }) => tierForName(name));
		let expected: "core" | "data" | "full" = "core";
		for (const tier of selectedTiers) {
			if (tier === "full" || (tier === "data" && expected === "core")) {
				expected = tier;
			}
		}
		expect(selectSnapshotTier(runtimeImports)).toEqual(Result.succeed(expected));
	}

	for (const { name, aliases } of SANDBOX_RUNTIME_REGISTRY) {
		for (const specifier of aliases) {
			expect(selectSnapshotTier([specifier])).toEqual(Result.succeed(tierForName(name)));
		}
	}

	expect(selectSnapshotTier([])).toEqual(Result.succeed("core"));

	const approvedSpecifiers = new Set<string>(
		SANDBOX_RUNTIME_REGISTRY.flatMap(({ aliases, sdkImport }) => [sdkImport, ...aliases]),
	);
	const nonApprovedImports = [
		...SANDBOX_RUNTIME_REGISTRY.map(({ name }) => name),
		"unknown",
	].filter((specifier) => !approvedSpecifiers.has(specifier));
	for (const specifier of nonApprovedImports) {
		const unknown = selectSnapshotTier([specifier]);
		expect(Result.isFailure(unknown) && unknown.failure.imports).toEqual([specifier]);
	}
});
