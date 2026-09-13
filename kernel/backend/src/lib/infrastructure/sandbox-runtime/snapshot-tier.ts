import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { Data, Match, Result } from "effect";

import type { SidecarTier } from "./sidecar-protocol";

type SnapshotTier = typeof SidecarTier.Type;

export class UnknownSandboxRuntimeImports extends Data.TaggedError("UnknownSandboxRuntimeImports")<{
	readonly imports: ReadonlyArray<string>;
}> {}

const tierByRuntimeName = (name: (typeof SANDBOX_RUNTIME_REGISTRY)[number]["name"]): SnapshotTier =>
	Match.value(name).pipe(
		Match.when("effect", () => "core" as const),
		Match.when("ryotql", () => "core" as const),
		Match.when("dependency-runtime", () => "core" as const),
		Match.when("filesystem", () => "core" as const),
		Match.when("youtubei", () => "full" as const),
		Match.when("cheerio", () => "data" as const),
		Match.when("fflate", () => "data" as const),
		Match.when("fast-xml-parser", () => "data" as const),
		Match.when("papaparse", () => "data" as const),
		Match.exhaustive,
	);

const tierByImport = new Map<string, SnapshotTier>(
	SANDBOX_RUNTIME_REGISTRY.flatMap(({ name, aliases, sdkImport }) => {
		const tier = tierByRuntimeName(name);
		return [sdkImport, ...aliases].map((specifier) => [specifier, tier] as const);
	}),
);

export const selectSnapshotTier = (
	runtimeImports: ReadonlyArray<string>,
): Result.Result<SnapshotTier, UnknownSandboxRuntimeImports> => {
	const unknownImports = runtimeImports.filter((specifier) => !tierByImport.has(specifier));
	if (unknownImports.length > 0) {
		return Result.fail(new UnknownSandboxRuntimeImports({ imports: unknownImports }));
	}

	let selected: SnapshotTier = "core";
	for (const specifier of runtimeImports) {
		const tier = tierByImport.get(specifier);
		if (tier === undefined) {
			return Result.fail(new UnknownSandboxRuntimeImports({ imports: [specifier] }));
		}
		if (tier === "full" || (tier === "data" && selected === "core")) {
			selected = tier;
		}
	}
	return Result.succeed(selected);
};
