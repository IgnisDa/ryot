import { createEventsWorker } from "~/modules/events";
import { createFitnessWorker } from "~/modules/fitness";
import { createMediaWorker } from "~/modules/media";

import { getSandboxService } from "../sandbox";

export const createWorkers = () => ({
	mediaWorker: createMediaWorker(),
	eventsWorker: createEventsWorker(),
	fitnessWorker: createFitnessWorker(),
	sandboxWorker: getSandboxService().createWorker(),
});

export type Workers = ReturnType<typeof createWorkers>;
