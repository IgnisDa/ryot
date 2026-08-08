import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import type { Atom } from "effect/unstable/reactivity";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useEntityUpdates } from "@/modules/entity-interest/use-entity-updates";

import {
	showActivityAtom,
	showEpisodesAtom,
	showOverviewAtom,
	showSeasonEpisodesAtom,
	showSummaryAtom,
} from "./atoms";
import { showOverviewEntityIds } from "./show-overview-state";

function useShowQuery<State extends { readonly status: string }>(props: {
	readonly label: string;
	readonly owner: string;
	readonly blocked: boolean;
	readonly atom: Atom.Atom<State>;
	readonly selectEntityIds: (state: State) => readonly string[];
}) {
	const state = useAtomValue(props.atom);
	const refresh = useAtomRefresh(props.atom);
	const entityIds = props.selectEntityIds(state);

	useInternalRequestFailureLogging(
		`${props.label} ${state.status}`,
		"cause" in state ? state.cause : undefined,
	);
	useEntityUpdates({
		entityIds,
		owner: props.owner,
		priority: "visible",
		blocked: props.blocked,
		onBatch: () => Effect.sync(refresh),
	});

	return { state, refresh };
}

export const useShowSummary = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		label: "show summary",
		owner: `show-summary:${entityId}`,
		selectEntityIds: () => [entityId],
		atom: showSummaryAtom({ scope, entityId }),
	});
};

export const useShowOverview = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		label: "show overview",
		owner: `show-overview:${entityId}`,
		atom: showOverviewAtom({ scope, entityId }),
		selectEntityIds: (state) =>
			state.status === "ready" ? [entityId, ...showOverviewEntityIds(state.overview)] : [entityId],
	});
};

export const useShowEpisodes = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		label: "show episodes",
		selectEntityIds: () => [entityId],
		owner: `show-episodes:${entityId}`,
		atom: showEpisodesAtom({ scope, entityId }),
	});
};

export const useShowSeasonEpisodes = (entityId: string, seasonId: string | null) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: seasonId === null,
		label: "show season episodes",
		owner: `show-season-episodes:${seasonId ?? entityId}`,
		atom: showSeasonEpisodesAtom({ scope, entityId, seasonId }),
		selectEntityIds: () => (seasonId === null ? [entityId] : [entityId, seasonId]),
	});
};

export const useShowActivity = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		label: "show activity",
		selectEntityIds: () => [entityId],
		owner: `show-activity:${entityId}`,
		atom: showActivityAtom({ scope, entityId }),
	});
};
