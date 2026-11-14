import type { ClientRendererDefinition } from "@ryot-app/contract/modules/pages/schemas";
import {
	ANALYTICS_KERNEL_RENDERER_DISPLAY_NAME,
	CALENDAR_KERNEL_RENDERER_DISPLAY_NAME,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { createSha256Hasher } from "@ryot-app/ts-utils/crypto";

import { kernelRendererSources } from "./sources.generated";

type KernelRendererPath = keyof typeof kernelRendererSources;

const encoder = new TextEncoder();

const ANALYTICS_PATHS = [
	"client/analytics-controls.tsx",
] as const satisfies readonly KernelRendererPath[];

const PUBLICATION_PATHS = [
	"client/publication-item.tsx",
] as const satisfies readonly KernelRendererPath[];

const COLLECTION_PATHS = [
	"client/collection-order.tsx",
] as const satisfies readonly KernelRendererPath[];

const COLLECTION_BROWSER_PATHS = [
	"client/collection-card-results.tsx",
	"client/entity-browser.tsx",
] as const satisfies readonly KernelRendererPath[];

const definition = (
	entry: KernelRendererPath,
	automaticEntityPresentations: boolean,
	analyticsSections: boolean,
) =>
	({
		entry,
		files: [],
		analyticsSections,
		pluginDependencies: {},
		automaticEntityPresentations,
		settingsSchema: { fields: {} },
	}) satisfies ClientRendererDefinition;

const renderer = (
	name: string,
	entry: KernelRendererPath,
	paths: readonly KernelRendererPath[],
	automaticEntityPresentations: boolean,
	analyticsSections = false,
) => {
	const included = [...new Set([entry, ...paths])].sort();
	const hasher = createSha256Hasher();
	for (const path of included) {
		const source = kernelRendererSources[path];
		hasher.update(`${path.length}:${path}:${source.length}:`);
		hasher.update(source);
	}
	return {
		name,
		sourceHash: hasher.digest("hex"),
		definition: definition(entry, automaticEntityPresentations, analyticsSections),
		files: Object.fromEntries(
			included.map((path) => [path, encoder.encode(kernelRendererSources[path])]),
		) as Readonly<Record<string, Uint8Array>>,
	};
};

export const kernelEntityBrowserRenderer = renderer(
	"Entity browser",
	"client/entity-browser.tsx",
	[],
	true,
);

export const kernelCollectionBrowserRenderer = renderer(
	"Collection browser",
	"client/collection-browser.tsx",
	COLLECTION_BROWSER_PATHS,
	true,
);

export const kernelResultsTableRenderer = renderer(
	"Results table",
	"client/results-table.tsx",
	[],
	false,
);

export const kernelCollectionDetailRenderer = renderer(
	"Collection detail",
	"client/collection-detail.tsx",
	COLLECTION_PATHS,
	true,
);

export const kernelPublicationRenderer = renderer(
	"Publication",
	"client/publication.tsx",
	PUBLICATION_PATHS,
	true,
);

export const kernelCalendarRenderer = renderer(
	CALENDAR_KERNEL_RENDERER_DISPLAY_NAME,
	"client/calendar.tsx",
	[],
	false,
);

export const kernelAnalyticsRenderer = renderer(
	ANALYTICS_KERNEL_RENDERER_DISPLAY_NAME,
	"client/analytics.tsx",
	ANALYTICS_PATHS,
	false,
	true,
);
