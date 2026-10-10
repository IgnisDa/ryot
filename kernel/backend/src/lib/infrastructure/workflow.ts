import { Effect, Layer, Option, type Schema } from "effect";
import {
	ClusterWorkflowEngine,
	RunnerAddress,
	RunnerHealth,
	Runners,
	Sharding,
	ShardingConfig,
	SocketRunner,
	SqlRunnerStorage,
} from "effect/cluster";
import { RpcSerialization } from "effect/rpc";

import { WorkflowGarbageCollectionStorageLive } from "#modules/garbage-collection/workflow-storage";

import { AppConfig, type AppConfigValue } from "./config/service";
import { PgClientLive } from "./db/postgres";
import { runnerSocketClientProtocolLayer, runnerSocketServerLayer } from "./runner-socket";
import { interactiveShardGroup } from "./workflow-lane";

export type DurableSchema = Schema.ConstraintCodec<unknown, unknown>;

type ServerLanes = AppConfigValue["server"]["lanes"];

const defaultShardGroup = "default";

const assignedShardGroups = {
	background: [defaultShardGroup],
	interactive: [interactiveShardGroup],
	all: [defaultShardGroup, interactiveShardGroup],
} satisfies Record<ServerLanes, ReadonlyArray<string>>;

export const shardingConfigFor = (lanes: ServerLanes) =>
	({
		shardLockDisableAdvisory: true,
		assignedShardGroups: assignedShardGroups[lanes],
		availableShardGroups: [defaultShardGroup, interactiveShardGroup],
		...(lanes === "all" ? {} : { runnerAddress: Option.some(RunnerAddress.make(lanes, 0)) }),
	}) satisfies Partial<ShardingConfig.ShardingConfig["Service"]>;

const runnerLayer = (server: AppConfigValue["server"]) => {
	const { lanes, runnerSocketDir } = server;
	if (lanes === "all" || Option.isNone(runnerSocketDir)) {
		return Sharding.layer.pipe(
			Layer.provideMerge(Runners.layerNoop),
			Layer.provide(RunnerHealth.layerNoop),
		);
	}
	const clientProtocol = runnerSocketClientProtocolLayer(runnerSocketDir.value);
	return SocketRunner.layer.pipe(
		Layer.provide(
			RunnerHealth.layerPing.pipe(Layer.provide(Runners.layerRpc), Layer.provide(clientProtocol)),
		),
		Layer.provide([runnerSocketServerLayer(runnerSocketDir.value, lanes), clientProtocol]),
		Layer.provide(RpcSerialization.layerNdjson),
	);
};

export const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(
	Layer.provideMerge(
		Layer.unwrap(
			Effect.map(AppConfig, (config) =>
				runnerLayer(config.server).pipe(
					Layer.provideMerge(WorkflowGarbageCollectionStorageLive),
					Layer.provide(Layer.orDie(SqlRunnerStorage.layer)),
					Layer.provide(ShardingConfig.layer(shardingConfigFor(config.server.lanes))),
				),
			),
		),
	),
	Layer.provide(PgClientLive),
);
