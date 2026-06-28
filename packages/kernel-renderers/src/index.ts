import type { ClientRendererDefinition } from "@ryot-app/contract/modules/client-pages/schemas";
import { createSha256Hasher } from "@ryot-app/ts-utils/crypto";

import { kernelRendererSources } from "./sources.generated";

type KernelRendererPath = keyof typeof kernelRendererSources;

const encoder = new TextEncoder();

const SHARED_PATHS = ["client/display-value.tsx"] as const satisfies readonly KernelRendererPath[];

const definition = (entry: KernelRendererPath, automaticEntityPresentations: boolean) =>
	({
		entry,
		files: [],
		pluginDependencies: [],
		automaticEntityPresentations,
		settingsSchema: { fields: {} },
	}) satisfies ClientRendererDefinition;

const renderer = (
	name: string,
	entry: KernelRendererPath,
	paths: readonly KernelRendererPath[],
	automaticEntityPresentations: boolean,
) => {
	const included = [...new Set([entry, ...paths, ...SHARED_PATHS])].sort();
	const hasher = createSha256Hasher();
	for (const path of included) {
		const source = kernelRendererSources[path];
		hasher.update(`${path.length}:${path}:${source.length}:`);
		hasher.update(source);
	}
	return {
		name,
		sourceHash: hasher.digest("hex"),
		definition: definition(entry, automaticEntityPresentations),
		files: Object.fromEntries(
			included.map((path) => [path, encoder.encode(kernelRendererSources[path])]),
		) as Readonly<Record<string, Uint8Array>>,
	};
};

export const kernelEntityBrowserRenderer = renderer(
	"Entity browser",
	"client/entity-browser.tsx",
	["client/browser-states.tsx", "client/browser-table.tsx"],
	true,
);

export const kernelResultsTableRenderer = renderer(
	"Results table",
	"client/results-table.tsx",
	[],
	false,
);
