import type { DbError } from "@ryot-app/contract/errors";
import type { AutomationOrigin } from "@ryot-app/contract/modules/automations/schemas";
import type { SignalId, SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { Database } from "#lib/infrastructure/db/service";

export type SignalDispatchInput = {
	id: SignalId;
	occurredAt: string;
	origin: AutomationOrigin;
	actorUserId: UserId | null;
	signalSchemaSlug: SignalSchemaSlug;
	properties: Record<string, unknown>;
	recipientUserIds: ReadonlyArray<UserId>;
};

type SignalDispatchValue = {
	dispatch: (input: SignalDispatchInput) => Effect.Effect<void, DbError, Database>;
};

export class SignalDispatch extends Context.Service<SignalDispatch, SignalDispatchValue>()(
	"SignalDispatch",
) {}
