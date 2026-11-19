import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";

import type { DomainLifecycleCommand } from "#modules/entities/write-context";

import { rootLifecycleCommand } from "./command";

export const apiLifecycleCommand = Effect.fnUntraced(function* (
	user: CurrentUserValue,
	itemIdentity: string,
) {
	return {
		...rootLifecycleCommand({
			itemIdentity,
			source: "api",
			lane: "interactive",
			accountUserId: user.id,
			initiator: { id: user.id, kind: "user" },
			executionId: AutomationExecutionId.make(generateId()),
			occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
		}),
		writeContext: null,
	} satisfies DomainLifecycleCommand;
});
