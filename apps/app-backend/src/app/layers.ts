import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { AuthLive } from "../lib/auth";
import { SeedLive } from "../lib/builtins/seed";
import { AppConfigLive } from "../lib/config";
import { DbLive, DbRunnerLive, TransactionRunnerLive } from "../lib/db";
import { MigrationsLive } from "../lib/db/migrate";
import { RedisLive } from "../lib/redis";
import { RelationshipSchemasRepositoryLive } from "../modules/relationship-schemas/repository";
import { RelationshipSchemasServiceLive } from "../modules/relationship-schemas/service";
import { TrackersRepositoryLive } from "../modules/trackers/repository";
import { TrackersServiceLive } from "../modules/trackers/service";
import { ServerLive } from "./server";

const RuntimeAfterMigrationsLive = MigrationsLive.pipe(
	Layer.flatMap(() => SeedLive.pipe(Layer.flatMap(() => ServerLive))),
);

export const AppLive = RuntimeAfterMigrationsLive.pipe(
	Layer.provide(TrackersServiceLive),
	Layer.provide(RelationshipSchemasServiceLive),
	Layer.provide(DbRunnerLive),
	Layer.provide(TransactionRunnerLive),
	Layer.provide(TrackersRepositoryLive),
	Layer.provide(RelationshipSchemasRepositoryLive),
	Layer.provide(AuthLive),
	Layer.provide(TransactionRunnerLive),
	Layer.provide(DbLive),
	Layer.provide(RedisLive),
	Layer.provide(AppConfigLive),
	Layer.provide(BunContext.layer),
);
