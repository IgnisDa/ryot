import { createEventsWorker } from "~/modules/events";
import { createMediaWorker } from "~/modules/media";
import { createSandboxWorker } from "../sandbox/worker";

export const createWorkers = () => ({
	mediaWorker: createMediaWorker(),
	eventsWorker: createEventsWorker(),
	sandboxWorker: createSandboxWorker(),
});

export type Workers = ReturnType<typeof createWorkers>;
