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

function useShowQuery<State extends { readonly status: string }>(props: {
	readonly label: string;
	readonly owner: string;
	readonly blocked: boolean;
	readonly atom: Atom.Atom<State>;
	readonly entityIds: readonly string[];
}) {
	const state = useAtomValue(props.atom);
	const refresh = useAtomRefresh(props.atom);

	useInternalRequestFailureLogging(
		`${props.label} ${state.status}`,
		"cause" in state ? state.cause : undefined,
	);
	useEntityUpdates({
		owner: props.owner,
		priority: "visible",
		blocked: props.blocked,
		entityIds: props.entityIds,
		onBatch: () => Effect.sync(refresh),
	});

	return { state, refresh };
}

export const useShowSummary = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		label: "show summary",
		entityIds: [entityId],
		owner: `show-summary:${entityId}`,
		atom: showSummaryAtom({ scope, entityId }),
	});
};

export const useShowOverview = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		entityIds: [entityId],
		label: "show overview",
		owner: `show-overview:${entityId}`,
		atom: showOverviewAtom({ scope, entityId }),
	});
};

export const useShowEpisodes = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		entityIds: [entityId],
		label: "show episodes",
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
		entityIds: seasonId === null ? [entityId] : [entityId, seasonId],
		atom: showSeasonEpisodesAtom({ scope, entityId, seasonId }),
	});
};

export const useShowActivity = (entityId: string) => {
	const scope = useApiScope();
	return useShowQuery({
		blocked: false,
		entityIds: [entityId],
		label: "show activity",
		owner: `show-activity:${entityId}`,
		atom: showActivityAtom({ scope, entityId }),
	});
};
