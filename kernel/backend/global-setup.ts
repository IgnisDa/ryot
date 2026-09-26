import { postgresGlobalSetup } from "@ryot-app/testing/postgres-container";

export default postgresGlobalSetup({ maxConnections: 100, label: "kernel-backend" });
