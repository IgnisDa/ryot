import {
	kernelEntityBrowserRenderer,
	kernelResultsTableRenderer,
} from "@ryot-app/kernel-renderers";

type KernelClientRenderer = typeof kernelEntityBrowserRenderer;

const kernelRenderers = new Map<string, KernelClientRenderer>([
	["entity-browser", kernelEntityBrowserRenderer],
	["results-table", kernelResultsTableRenderer],
]);

export const getKernelClientRenderer = (name: string) => kernelRenderers.get(name);
