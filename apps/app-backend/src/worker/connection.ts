import { Pool } from "pg";
import { config } from "~/lib/config";

let sharedWorkerPool: Pool | null = null;

export const getWorkerPool = () => {
	if (!sharedWorkerPool)
		sharedWorkerPool = new Pool({
			connectionString: config.DATABASE_URL,
		});

	return sharedWorkerPool;
};

export const shutdownWorkerPool = async () => {
	if (!sharedWorkerPool) return;

	await sharedWorkerPool.end();
	sharedWorkerPool = null;
};
