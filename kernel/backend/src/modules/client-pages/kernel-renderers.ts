import { kernelEntityBrowserRenderer } from "./entity-browser-renderer";
import { kernelResultsTableRenderer } from "./results-table-renderer";

type KernelClientRenderer = typeof kernelEntityBrowserRenderer | typeof kernelResultsTableRenderer;

const kernelRenderers = new Map<string, KernelClientRenderer>([
	["entity-browser", kernelEntityBrowserRenderer],
	["results-table", kernelResultsTableRenderer],
]);

export const getKernelClientRenderer = (name: string) => kernelRenderers.get(name);
