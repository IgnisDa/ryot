import { postgresGlobalSetup } from "@ryot-app/testing/postgres-container";
import { redisGlobalSetup } from "@ryot-app/testing/redis-container";

const setupPostgres = postgresGlobalSetup({ maxConnections: 100, label: "kernel-backend" });
const setupRedis = redisGlobalSetup({ label: "kernel-backend" });

// oxlint-disable-next-line effecttsgo/async-function -- Vitest globalSetup owns the Promise-returning setup contract.
export default async (project: {
	provide: (key: "databaseUrl" | "redisUrl", value: string) => void;
}) => {
	const teardowns = await Promise.all([setupPostgres(project), setupRedis(project)]);
	return () => Promise.all(teardowns.map((teardown) => teardown()));
};
