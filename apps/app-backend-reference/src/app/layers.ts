import { FetchHttpClient } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { AuthService } from "../lib/auth";
import { AppConfig } from "../lib/config";
import { DbService, TransactionRunnerLive } from "../lib/db";
import { OtelLive } from "../lib/metrics";
import { MigrationsComplete } from "../lib/migrate";
import { RedisService } from "../lib/redis";
import { SandboxService } from "../lib/sandbox";
import { SchedulerLive } from "../lib/scheduler";
import { PersistedQueueLive, WorkflowEngineLive } from "../lib/workflow";
import { AudibleRepository } from "../modules/audible/repository";
import { AudibleService } from "../modules/audible/service";
import { WorkflowDefinitionsLive } from "../modules/audible/workflows";
import { PatternsRepository } from "../modules/patterns/repository";
import { PatternsService } from "../modules/patterns/service";
import { SandboxApiService } from "../modules/sandbox/service";
import { UploadsRepository } from "../modules/uploads/repository";
import { UploadsService } from "../modules/uploads/service";
import { ServerLive } from "./server";

const RuntimeLive = Layer.mergeAll(ServerLive, SchedulerLive, WorkflowDefinitionsLive);

const RuntimeAfterMigrationsLive = MigrationsComplete.Default.pipe(
	Layer.flatMap(() => RuntimeLive),
);

export const AppLive = RuntimeAfterMigrationsLive.pipe(
	Layer.provide(AudibleService.Default),
	Layer.provide(SandboxApiService.Default),
	Layer.provide(PatternsService.Default),
	Layer.provide(TransactionRunnerLive),
	Layer.provide(UploadsService.Default),
	Layer.provide(AudibleRepository.Default),
	Layer.provide(PatternsRepository.Default),
	Layer.provide(UploadsRepository.Default),
	Layer.provide(PersistedQueueLive),
	Layer.provide(WorkflowEngineLive),
	Layer.provide(SandboxService.Default),
	Layer.provide(AuthService.Default),
	Layer.provide(DbService.Default),
	Layer.provide(RedisService.Default),
	Layer.provide(OtelLive),
	Layer.provide(AppConfig.Default),
	Layer.provide(FetchHttpClient.layer),
	Layer.provide(BunContext.layer),
);
