import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { AppConfigLive } from "../lib/config";
import { ServerLive } from "./server";

export const AppLive = ServerLive.pipe(
	Layer.provide(AppConfigLive),
	Layer.provide(BunContext.layer),
);
