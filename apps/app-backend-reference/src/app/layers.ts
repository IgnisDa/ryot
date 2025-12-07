import { FetchHttpClient } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { AuthLive } from "../lib/auth";
import { AppConfigLive } from "../lib/config";
import { DbLive, TransactionRunnerLive } from "../lib/db";
import { OtelLive } from "../lib/metrics";
import { MigrationsLive } from "../lib/migrate";
import { RedisLive } from "../lib/redis";
import { SandboxLive } from "../lib/sandbox";
import { SchedulerLive } from "../lib/scheduler";
import { PersistedQueueLive, WorkflowEngineLive } from "../lib/workflow";
import { AudibleRepositoryLive } from "../modules/audible/repository";
import { AudibleServiceLive } from "../modules/audible/service";
import { WorkflowDefinitionsLive } from "../modules/audible/workflows";
import { PatternsRepositoryLive } from "../modules/patterns/repository";
import { PatternsServiceLive } from "../modules/patterns/service";
import { SandboxApiServiceLive } from "../modules/sandbox/service";
import { UploadsRepositoryLive } from "../modules/uploads/repository";
import { UploadsServiceLive } from "../modules/uploads/service";
import { ServerLive } from "./server";

const RuntimeLive = Layer.mergeAll(ServerLive, SchedulerLive, WorkflowDefinitionsLive);

const RuntimeAfterMigrationsLive = MigrationsLive.pipe(Layer.flatMap(() => RuntimeLive));

export const AppLive = RuntimeAfterMigrationsLive.pipe(
	Layer.provide(AudibleServiceLive),
	Layer.provide(SandboxApiServiceLive),
	Layer.provide(PatternsServiceLive),
	Layer.provide(TransactionRunnerLive),
	Layer.provide(UploadsServiceLive),
	Layer.provide(AudibleRepositoryLive),
	Layer.provide(PatternsRepositoryLive),
	Layer.provide(UploadsRepositoryLive),
	Layer.provide(PersistedQueueLive),
	Layer.provide(WorkflowEngineLive),
	Layer.provide(SandboxLive),
	Layer.provide(AuthLive),
	Layer.provide(DbLive),
	Layer.provide(RedisLive),
	Layer.provide(OtelLive),
	Layer.provide(AppConfigLive),
	Layer.provide(FetchHttpClient.layer),
	Layer.provide(BunContext.layer),
);
