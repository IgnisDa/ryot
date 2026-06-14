import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { AuthService } from "../lib/auth";
import { SeedService } from "../lib/builtins/seed";
import { AppConfig } from "../lib/config";
import { DbService, DbRunnerLive, TransactionRunnerLive } from "../lib/db";
import { MigrationsComplete } from "../lib/db/migrate";
import { RedisService } from "../lib/redis";
import { RelationshipSchemasRepository } from "../modules/relationship-schemas/repository";
import { RelationshipSchemasService } from "../modules/relationship-schemas/service";
import { TrackersRepository } from "../modules/trackers/repository";
import { TrackersService } from "../modules/trackers/service";
import { ServerLive } from "./server";

const RuntimeAfterMigrationsLive = MigrationsComplete.Default.pipe(
	Layer.flatMap(() => SeedService.Default.pipe(Layer.flatMap(() => ServerLive))),
);

export const AppLive = RuntimeAfterMigrationsLive.pipe(
	Layer.provide(TrackersService.Default),
	Layer.provide(RelationshipSchemasService.Default),
	Layer.provide(DbRunnerLive),
	Layer.provide(TrackersRepository.Default),
	Layer.provide(RelationshipSchemasRepository.Default),
	Layer.provide(AuthService.Default),
	Layer.provide(TransactionRunnerLive),
	Layer.provide(DbService.Default),
	Layer.provide(RedisService.Default),
	Layer.provide(AppConfig.Default),
	Layer.provide(BunContext.layer),
);
