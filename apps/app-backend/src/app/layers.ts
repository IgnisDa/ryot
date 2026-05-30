import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { SeedLive } from "../lib/builtins/seed";
import { AppConfigLive } from "../lib/config";
import { DbLive, TransactionRunnerLive } from "../lib/db";
import { MigrationsLive } from "../lib/db/migrate";
import { ServerLive } from "./server";

const RuntimeAfterMigrationsLive = MigrationsLive.pipe(
	Layer.flatMap(() => SeedLive.pipe(Layer.flatMap(() => ServerLive))),
);

export const AppLive = RuntimeAfterMigrationsLive.pipe(
	Layer.provide(TransactionRunnerLive),
	Layer.provide(DbLive),
	Layer.provide(AppConfigLive),
	Layer.provide(BunContext.layer),
);
