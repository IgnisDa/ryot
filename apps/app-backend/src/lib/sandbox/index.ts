import { SandboxService } from "./service";

let sandboxService: SandboxService | null = null;

export const initializeSandboxService = async () => {
	if (sandboxService) return sandboxService;
	sandboxService = new SandboxService();
	await sandboxService.start();
	console.info("Sandbox service initialized");
	return sandboxService;
};

export const getSandboxService = () => {
	if (!sandboxService)
		throw new Error(
			"Sandbox service not initialized. Call initializeSandboxService() first.",
		);
	return sandboxService;
};

export const shutdownSandboxService = async () => {
	if (!sandboxService) return;
	await sandboxService.stop();
	sandboxService = null;
	console.info("Sandbox service shut down");
};

export type { SandboxResult, SandboxRunOptions } from "./types";
