import { hc } from "hono/client";
import type { AppType, baseApp } from "~/app/api";

export type Client = ReturnType<typeof hc<typeof baseApp>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
	hc<AppType>(...args);
