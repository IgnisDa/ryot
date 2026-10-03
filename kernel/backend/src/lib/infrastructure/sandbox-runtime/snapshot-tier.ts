import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { Data, Result } from "effect";

import type { SidecarTier } from "./sidecar-protocol";

type SnapshotTier = typeof SidecarTier.Type;

export class UnknownSandboxRuntimeImports extends Data.TaggedError("UnknownSandboxRuntimeImports")<{
	readonly imports: ReadonlyArray<string>;
}> {}

const tierByRuntimeName = {
	effect: "core",
	ryotql: "core",
	fflate: "data",
	cheerio: "data",
	youtubei: "full",
	papaparse: "data",
	filesystem: "core",
	"fast-xml-parser": "data",
	"dependency-runtime": "core",
} as const satisfies Record<(typeof SANDBOX_RUNTIME_REGISTRY)[number]["name"], SnapshotTier>;

const tierByImport = new Map<string, SnapshotTier>(
	SANDBOX_RUNTIME_REGISTRY.flatMap(({ name, aliases, sdkImport }) =>
		[sdkImport, ...aliases].map((specifier) => [specifier, tierByRuntimeName[name]] as const),
	),
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
		if (tier === "full" || (tier === "data" && selected === "core")) {
			selected = tier;
		}
	}
	return Result.succeed(selected);
};
