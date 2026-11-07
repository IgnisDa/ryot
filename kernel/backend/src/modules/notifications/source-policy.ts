import type { DbError } from "@ryot-app/contract/errors";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

export class NotificationSourcePolicy extends Context.Service<
	NotificationSourcePolicy,
	{
		readonly authorize: (input: {
			runId: null | string;
			accountUserId: UserId;
		}) => Effect.Effect<boolean, DbError>;
	}
>()("@ryot-app/kernel-backend/modules/notifications/source-policy/NotificationSourcePolicy") {}
