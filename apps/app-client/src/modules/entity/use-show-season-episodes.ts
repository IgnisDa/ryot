import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useEntityUpdates } from "@/modules/entity-interest/use-entity-updates";

import { showSeasonEpisodesAtom } from "./atoms";

export const useShowSeasonEpisodes = (entityId: string, seasonId: string | null) => {
	const scope = useApiScope();
	const atom = showSeasonEpisodesAtom({ scope, entityId, seasonId });
	const state = useAtomValue(atom);
	const refresh = useAtomRefresh(atom);

	useInternalRequestFailureLogging(
		`show season episodes ${state.status}`,
		"cause" in state ? state.cause : undefined,
	);
	useEntityUpdates({
		priority: "visible",
		blocked: seasonId === null,
		onBatch: () => Effect.sync(refresh),
		owner: `show-season-episodes:${seasonId ?? entityId}`,
		entityIds: seasonId === null ? [entityId] : [entityId, seasonId],
	});

	return { state, refresh };
};
