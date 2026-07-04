import type { DbError } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type { SignalId, SignalSchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { Context, type Effect } from "effect";

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
	dispatch: (input: SignalDispatchInput) => Effect.Effect<void, DbError>;
};

export class SignalDispatch extends Context.Service<SignalDispatch, SignalDispatchValue>()(
	"SignalDispatch",
) {}
