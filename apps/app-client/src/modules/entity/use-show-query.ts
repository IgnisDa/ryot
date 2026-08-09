import type { Atom } from "effect/unstable/reactivity";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useInterestedAtom } from "@/modules/entity-interest/use-interested-atom";

import {
	showActivityAtom,
	showEpisodesAtom,
	showOverviewAtom,
	showSeasonEpisodesAtom,
	showSummaryAtom,
} from "./atoms";
import { showSeasonEpisodeEntityIds } from "./show-episodes-state";
import { showOverviewEntityIds } from "./show-overview-state";

function useShowQuery<State extends { readonly status: string }>(props: {
	readonly label: string;
	readonly blocked: boolean;
	readonly atom: Atom.Atom<State>;
	readonly selectEntityIds: (state: State) => readonly string[];
}) {
	const { state, refresh } = useInterestedAtom({
		atom: props.atom,
		blocked: props.blocked,
		selectEntityIds: props.selectEntityIds,
	});

	useInternalRequestFailureLogging(
		`${props.label} ${state.status}`,
		"cause" in state ? state.cause : undefined,
	);

	return { state, refresh };
}

export const useShowSummary = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		label: "show summary",
		selectEntityIds: () => [entityId],
		atom: showSummaryAtom({ scope, entityId }),
	});
};

export const useShowOverview = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		label: "show overview",
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
		atom: showEpisodesAtom({ scope, entityId }),
	});
};

export const useShowSeasonEpisodes = (entityId: string, seasonId: string | null) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: seasonId === null,
		label: "show season episodes",
		atom: showSeasonEpisodesAtom({ scope, entityId, seasonId }),
		selectEntityIds: (state) =>
			seasonId === null ? [entityId] : [entityId, seasonId, ...showSeasonEpisodeEntityIds(state)],
	});
};

export const useShowActivity = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		label: "show activity",
		selectEntityIds: () => [entityId],
		atom: showActivityAtom({ scope, entityId }),
	});
};
