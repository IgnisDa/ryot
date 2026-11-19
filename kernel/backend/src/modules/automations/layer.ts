import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { ScriptGarbageCollector } from "#modules/garbage-collection/scripts";
import { PluginRepositoryLive } from "#modules/plugins/packages/repository-layer";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { JobQueue } from "#platform/jobs/queue";

import { AutomationAttemptRepository } from "./attempt-repository";
import { AutomationExecutionOperationsLive, LifecycleExecutionLive } from "./execution";
import { NotificationSubscriptionsService } from "./notification-subscriptions-service";
import { LifecyclePlannerLive } from "./planner";
import { AutomationPlannerResolver } from "./planner-resolver";
import { LifecyclePoliciesLive } from "./policies";
import { AutomationReconciliation, AutomationReconciliationOperationsLive } from "./reconciliation";
import { AutomationsRepository } from "./repository";
import { AutomationRetention } from "./retention";
import { AutomationRunOperationsLive } from "./run-job-live";
import { AutomationRunRepository } from "./run-repository";
import { SignalEmissionService } from "./signal-service";
import { AutomationTriggerRepository } from "./trigger-repository";

const AutomationExecutionOperationsServiceLive = AutomationExecutionOperationsLive.pipe(
	Layer.provide(AutomationRunRepository.layer),
);

const plannerResolver = AutomationPlannerResolver.layer.pipe(
	Layer.provide(PluginRepositoryLive),
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

export const LifecyclePoliciesServiceLive = LifecyclePoliciesLive.pipe(
	Layer.provide(Layer.mergeAll(plannerResolver, SandboxRepository.layer, EntitiesRepositoryLive)),
);

export const LifecycleServicesLive = Layer.mergeAll(
	LifecyclePlannerServiceLive,
	execution,
	LifecyclePoliciesServiceLive.pipe(Layer.provide(ScriptCalls.layer)),
);

export const MigrationLifecycleServicesLive = LifecycleServicesLive.pipe(
	Layer.provide(JobQueue.layer),
);

export const AutomationRunOperationsServiceLive = AutomationRunOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			AutomationAttemptRepository.layer,
			AutomationRunRepository.layer,
			AutomationTriggerRepository.layer,
			SandboxRepository.layer,
			ScriptCalls.layer,
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
			ScriptGarbageCollector.layer.pipe(Layer.provide(PluginRepositoryLive)),
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
			EntitiesRepositoryLive,
			RelationshipsRepository.layer,
		),
	),
	Layer.provide(PluginRepositoryLive),
	Layer.provide(DefinitionRepository.layer),
);
