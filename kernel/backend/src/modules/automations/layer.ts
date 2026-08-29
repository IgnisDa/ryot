import { Layer } from "effect";

import { WorkflowEngineLive } from "#lib/infrastructure/workflow";
import { DefinitionRepository } from "#modules/definition-registry/repository";

import { AutomationExecutionOperationsLive, LifecycleExecutionLive } from "./execution";
import { LifecyclePlannerLive } from "./planner";
import { AutomationRunRepository } from "./run-repository";

const execution = LifecycleExecutionLive.pipe(
	Layer.provide(
		AutomationExecutionOperationsLive.pipe(Layer.provide(AutomationRunRepository.layer)),
	),
);

export const LifecycleServicesLive = Layer.merge(
	LifecyclePlannerLive.pipe(Layer.provide(DefinitionRepository.layer)),
	execution,
);

export const MigrationLifecycleServicesLive = LifecycleServicesLive.pipe(
	Layer.provide(WorkflowEngineLive),
);
