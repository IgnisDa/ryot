import { setupE2e } from "./global-setup";

export default () => setupE2e({ SANDBOX_WORKER_CONCURRENCY: "2" });
