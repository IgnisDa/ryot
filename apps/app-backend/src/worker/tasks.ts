import { quickAddJob } from "graphile-worker";
import { z } from "zod";
import { getWorkerPool } from "./connection";

export const DEMO_JOB = "demoJob";

export const demoJobPayloadSchema = z.object({
	message: z.string(),
});

export type DemoJobPayload = z.infer<typeof demoJobPayloadSchema>;

export const addJob = async (taskIdentifier: string, payload: unknown) => {
	const pool = getWorkerPool();
	await quickAddJob({ pgPool: pool }, taskIdentifier, payload);
};
