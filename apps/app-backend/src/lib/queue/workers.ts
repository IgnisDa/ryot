import { createEventsWorker } from "~/modules/events";
import { createSandboxScriptWorker } from "../sandbox/worker";

export const createWorkers = () => ({
	eventsWorker: createEventsWorker(),
	sandboxScriptWorker: createSandboxScriptWorker(),
});

export type Workers = ReturnType<typeof createWorkers>;
