import type { DbError } from "@ryot-app/contract/errors";
import { Context, type Effect } from "effect";

import type { LifecycleDispatchPlan, LifecyclePersistenceError } from "./planning";

export class LifecycleExecution extends Context.Service<
	LifecycleExecution,
	{
		/** Queues a committed write's after-hook runs as jobs. */
		dispatch: (
			plans: ReadonlyArray<LifecycleDispatchPlan>,
		) => Effect.Effect<void, DbError | LifecyclePersistenceError>;
	}
>()("@ryot-app/kernel-backend/modules/automations/lifecycle/execution/LifecycleExecution") {}
