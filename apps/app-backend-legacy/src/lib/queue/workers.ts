import { ensureEntityInLibrary } from "~/modules/collections";
import { createEntityImportWorker } from "~/modules/entities/worker";
import { createEventsWorker } from "~/modules/events";
import { createImportWorker } from "~/modules/imports";

import { getSandboxService } from "../sandbox";

const createWorkers = () => ({
	importWorker: createImportWorker(),
	sandboxWorker: getSandboxService().createWorker(),
	entityImportWorker: createEntityImportWorker({
		onEntityImported: (input) => ensureEntityInLibrary(input),
	}),
	eventsWorker: createEventsWorker({
		onGlobalEntityScope: (input) => ensureEntityInLibrary(input),
	}),
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
			workers.eventsWorker.close(),
			workers.importWorker.close(),
			workers.sandboxWorker.close(),
			workers.entityImportWorker.close(),
		]);
		workers = null;
		console.info("Workers shut down");
	}
};
