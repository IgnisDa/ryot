import type { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { Context, type Effect } from "effect";

export class NotificationSourcePolicy extends Context.Service<
	NotificationSourcePolicy,
	{
		readonly authorize: (input: {
			runId: null | string;
			accountGeneration: AccountGeneration;
		}) => Effect.Effect<boolean, DbError>;
	}
>()("@ryot-app/kernel-backend/modules/notifications/source-policy/NotificationSourcePolicy") {}
