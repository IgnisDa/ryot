import { createEventsWorker } from "~/modules/events";
import { createMediaWorker } from "~/modules/media";
import { getSandboxService } from "../sandbox";

export const createWorkers = () => ({
	mediaWorker: createMediaWorker(),
	eventsWorker: createEventsWorker(),
	sandboxWorker: getSandboxService().createWorker(),
});

export type Workers = ReturnType<typeof createWorkers>;
