import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useEntityUpdates } from "@/modules/entity-interest/use-entity-updates";

import { showActivityAtom } from "./atoms";

export const useShowActivity = (entityId: string) => {
	const scope = useApiScope();
	const atom = showActivityAtom({ scope, entityId });
	const state = useAtomValue(atom);
	const refresh = useAtomRefresh(atom);

	useInternalRequestFailureLogging(
		`show activity ${state.status}`,
		"cause" in state ? state.cause : undefined,
	);
	useEntityUpdates({
		blocked: false,
		priority: "visible",
		entityIds: [entityId],
		owner: `show-activity:${entityId}`,
		onBatch: () => Effect.sync(refresh),
	});

	return { state, refresh };
};
