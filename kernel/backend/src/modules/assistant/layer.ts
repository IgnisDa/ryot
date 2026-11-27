import { Effect, Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { AgentToolsServiceLive } from "#modules/agent-tools/layer";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { PageAuthoringServiceLive } from "#modules/pages/authoring/layer";
import { SavedViewsServiceLive } from "#modules/saved-views/layer";

import { AssistantProviderConfiguration } from "./provider-configuration";
import { AssistantModel } from "./provider-model";
import { AssistantRepository } from "./repository";
import { AssistantSavePage } from "./save-page";
import { AssistantService } from "./service";
import { AssistantTurnRuntime } from "./turn-runtime";
import { AssistantWorkflowLive } from "./workflow-live";

const AssistantPersistenceLive = Layer.mergeAll(AssistantRepository.layer, AuthServiceLive);
export const AssistantServiceLive = AssistantService.layer.pipe(
	Layer.provide(AssistantPersistenceLive),
);
export const AssistantSavePageLive = AssistantSavePage.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AssistantPersistenceLive,
			IdempotencyKeys.layer,
			PageAuthoringServiceLive,
			SavedViewsServiceLive,
		),
	),
);
export const AssistantWorkflowDefinitionsLive = AssistantWorkflowLive.pipe(
	Layer.provide(
		AssistantTurnRuntime.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					AssistantPersistenceLive,
					AgentToolsServiceLive,
					DefinitionCatalog.layer,
					AssistantProviderConfiguration.layer,
					AssistantModel.live,
				),
			),
		),
	),
);
export const AssistantRecoveryLive = Layer.effectDiscard(
	Effect.flatMap(AssistantService, (service) => service.recover()),
);
