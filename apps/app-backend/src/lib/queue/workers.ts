import { createEventsWorker } from "~/modules/events";
import { createSandboxWorker } from "../sandbox/worker";

export const createWorkers = () => ({
	eventsWorker: createEventsWorker(),
	sandboxWorker: createSandboxWorker(),
});

export type Workers = ReturnType<typeof createWorkers>;
