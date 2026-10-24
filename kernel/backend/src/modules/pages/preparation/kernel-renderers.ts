import type { ClientCompositionModuleReference } from "@ryot-app/contract/modules/pages/schemas";
import {
	kernelCalendarRenderer,
	kernelCollectionBrowserRenderer,
	kernelCollectionDetailRenderer,
	kernelEntityBrowserRenderer,
	kernelResultsTableRenderer,
} from "@ryot-app/kernel-renderers";

type KernelClientRenderer = typeof kernelEntityBrowserRenderer;

const kernelRenderers = new Map<string, KernelClientRenderer>([
	["calendar", kernelCalendarRenderer],
	["collection-browser", kernelCollectionBrowserRenderer],
	["entity-browser", kernelEntityBrowserRenderer],
	["results-table", kernelResultsTableRenderer],
]);

export const kernelRendererModule = (name: string): ClientCompositionModuleReference => ({
	binding: "page",
	specifier: `@ryot-app/kernel-renderers/${name}`,
});

export const getKernelClientRenderer = (name: string) => kernelRenderers.get(name);

const kernelEntityRenderers = new Map<string, KernelClientRenderer>([
	["collection", kernelCollectionDetailRenderer],
]);

export const getKernelEntityRenderer = (entitySchemaSlug: string) =>
	kernelEntityRenderers.get(entitySchemaSlug);

export const listKernelEntityRenderers = () => [...kernelEntityRenderers.values()];
