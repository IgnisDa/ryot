import type { DbError } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type { SignalId, SignalSchemaId, UserId } from "@ryot/contract/schema/brands";
import { Context, type Effect } from "effect";

export type SignalDispatchInput = {
	id: SignalId;
	occurredAt: string;
	signalSchemaSlug: string;
	origin: AutomationOrigin;
	actorUserId: UserId | null;
	signalSchemaId: SignalSchemaId;
	properties: Record<string, unknown>;
	recipientUserIds: ReadonlyArray<UserId>;
};

export type SignalDispatchValue = {
	dispatch: (input: SignalDispatchInput) => Effect.Effect<void, DbError>;
};

export class SignalDispatch extends Context.Tag("SignalDispatch")<
	SignalDispatch,
	SignalDispatchValue
>() {}
