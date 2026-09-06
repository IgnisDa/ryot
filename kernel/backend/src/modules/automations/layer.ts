import { Layer } from "effect";

import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { WorkflowEngineLive } from "#lib/infrastructure/workflow";
import { ClientArtifactsRepository } from "#modules/client-artifacts/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { PluginRepository } from "#modules/plugins/repository";
import { ScriptGarbageCollector } from "#modules/plugins/script-garbage-collector";
import { RelationshipSchemasRepositoryLive } from "#modules/relationship-schemas/layer";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SignalSchemasRepositoryLive } from "#modules/signals/layer";

import { AutomationAttemptRepository } from "./attempt-repository";
import { AutomationExecutionOperationsLive, LifecycleExecutionLive } from "./execution";
import { AutomationHistoryRepository } from "./history-repository";
import { AutomationHistoryService } from "./history-service";
import { NotificationSubscriptionsService } from "./notification-subscriptions-service";
import { LifecyclePlannerLive } from "./planner";
import { AutomationPlannerResolver } from "./planner-resolver";
import { AutomationReconciliation, AutomationReconciliationOperationsLive } from "./reconciliation";
import { AutomationsRepository } from "./repository";
import { AutomationRetention } from "./retention";
import { AutomationRunRepository } from "./run-repository";
import { AutomationRunWorkflowOperationsLive } from "./run-workflow-live";
import { SignalEmissionService } from "./signal-service";
import { AutomationTriggerRepository } from "./trigger-repository";

export const AutomationRepositoriesLive = Layer.mergeAll(
	AutomationAttemptRepository.layer,
	AutomationHistoryRepository.layer,
	AutomationRunRepository.layer,
	AutomationTriggerRepository.layer,
	AutomationsRepository.layer,
);

export const AutomationExecutionOperationsServiceLive = AutomationExecutionOperationsLive.pipe(
	Layer.provide(AutomationRunRepository.layer),
);

const plannerResolver = AutomationPlannerResolver.layer.pipe(
	Layer.provide(PluginRepository.layer.pipe(Layer.provide(ClientArtifactsRepository.layer))),
	Layer.provide(DefinitionRepository.layer),
);

const execution = LifecycleExecutionLive.pipe(
	Layer.provide(AutomationExecutionOperationsServiceLive),
);

export const LifecyclePlannerServiceLive = LifecyclePlannerLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			plannerResolver,
			AutomationTriggerRepository.layer,
			AutomationRunRepository.layer,
		),
	),
);

export const LifecycleServicesLive = Layer.merge(LifecyclePlannerServiceLive, execution);

export const MigrationLifecycleServicesLive = LifecycleServicesLive.pipe(
	Layer.provide(WorkflowEngineLive),
);

export const AutomationHistoryServiceLive = AutomationHistoryService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AutomationAttemptRepository.layer,
			AutomationExecutionOperationsServiceLive,
			AutomationHistoryRepository.layer,
		),
	),
);

export const AutomationRunWorkflowOperationsServiceLive = AutomationRunWorkflowOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			AutomationAttemptRepository.layer,
			AutomationRunRepository.layer,
			AutomationTriggerRepository.layer,
			SandboxRepository.layer,
		),
	),
);

export const AutomationReconciliationLive = AutomationReconciliation.layer.pipe(
	Layer.provide(
		AutomationReconciliationOperationsLive.pipe(
			Layer.provide(
				Layer.merge(AutomationExecutionOperationsServiceLive, AutomationRunRepository.layer),
			),
		),
	),
);

export const AutomationRetentionLive = AutomationRetention.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AutomationAttemptRepository.layer,
			AutomationRunRepository.layer,
			AutomationTriggerRepository.layer,
			ScriptGarbageCollector.layer.pipe(
				Layer.provide(
					Layer.merge(
						PluginRepository.layer.pipe(Layer.provide(ClientArtifactsRepository.layer)),
						PackageCacheManager.layer,
					),
				),
			),
		),
	),
);

export const NotificationSubscriptionsServiceLive = NotificationSubscriptionsService.layer.pipe(
	Layer.provide(Layer.merge(AutomationsRepository.layer, DefinitionRepository.layer)),
);

export const SignalEmissionServiceLive = SignalEmissionService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			LifecycleServicesLive,
			AutomationTriggerRepository.layer,
			SignalSchemasRepositoryLive,
			EntitiesRepositoryLive,
			RelationshipsRepository.layer,
			RelationshipSchemasRepositoryLive,
		),
	),
	Layer.provide(PluginRepository.layer.pipe(Layer.provide(ClientArtifactsRepository.layer))),
	Layer.provide(DefinitionRepository.layer),
);
