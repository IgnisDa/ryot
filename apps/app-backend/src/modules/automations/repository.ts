import type {
	AutomationRuleId,
	EventSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { makeAutomationHistoryRepository } from "./repository-history";
import { makeAutomationNotificationRepository } from "./repository-notifications";
import { makeAutomationRuleRepository } from "./repository-rules";
import { makeAutomationRunRepository } from "./repository-runs";
import { makeAutomationSourceRepository } from "./repository-source";

export type EventCreatePolicyRow = {
	readonly position: number;
	readonly id: AutomationRuleId;
	readonly eventSchemaId: EventSchemaId;
	readonly sandboxScriptId: SandboxScriptId;
};

export class AutomationsRepository extends Effect.Service<AutomationsRepository>()(
	"AutomationsRepository",
	{
		sync: () => ({
			...makeAutomationSourceRepository(),
			...makeAutomationRunRepository(),
			...makeAutomationNotificationRepository(),
			...makeAutomationHistoryRepository(),
			...makeAutomationRuleRepository(),
		}),
	},
) {}
