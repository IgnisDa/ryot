import { createEventsWorker } from "~/modules/events";
import { createFitnessWorker } from "~/modules/fitness";
import { createMediaWorker } from "~/modules/media";

import { getSandboxService } from "../sandbox";

const createWorkers = () => ({
	mediaWorker: createMediaWorker(),
	eventsWorker: createEventsWorker(),
	fitnessWorker: createFitnessWorker(),
	sandboxWorker: getSandboxService().createWorker(),
});

export type Workers = ReturnType<typeof createWorkers>;

let workers: Workers | null = null;

export const initializeWorkers = () => {
	workers = createWorkers();
	console.info("Workers initialized");
	return workers;
};

export const getWorkers = () => {
	if (!workers) {
		throw new Error("Workers not initialized. Call initializeWorkers() first.");
	}
	return workers;
};

export const shutdownWorkers = async () => {
	if (workers) {
		await Promise.all([
			workers.mediaWorker.close(),
			workers.eventsWorker.close(),
			workers.fitnessWorker.close(),
			workers.sandboxWorker.close(),
		]);
		workers = null;
		console.info("Workers shut down");
	}
};
