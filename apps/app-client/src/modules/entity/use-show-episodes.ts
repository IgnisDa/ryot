import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useEntityUpdates } from "@/modules/entity-interest/use-entity-updates";

import { showEpisodesAtom } from "./atoms";

export const useShowEpisodes = (entityId: string) => {
	const scope = useApiScope();
	const atom = showEpisodesAtom({ scope, entityId });
	const state = useAtomValue(atom);
	const refresh = useAtomRefresh(atom);

	useInternalRequestFailureLogging(
		`show episodes ${state.status}`,
		"cause" in state ? state.cause : undefined,
	);
	useEntityUpdates({
		blocked: false,
		priority: "visible",
		entityIds: [entityId],
		owner: `show-episodes:${entityId}`,
		onBatch: () => Effect.sync(refresh),
	});

	return { state, refresh };
};
