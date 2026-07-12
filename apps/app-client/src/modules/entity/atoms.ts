import {
	showActivityRecipe,
	showOverviewRecipe,
	showSeasonEpisodesRecipe,
	showSeasonsRecipe,
	showSummaryRecipe,
} from "@ryot/media-plugin/query-recipes";
import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";

import { mapShowActivity } from "./show-activity-state";
import {
	mapShowEpisodes,
	mapShowSeasonEpisodes,
	type ShowSeasonEpisodesState,
} from "./show-episodes-state";
import { mapShowOverview } from "./show-overview-state";
import { mapShowSummary } from "./show-summary-state";

const SHOW_PEOPLE_LIMIT = 12;
const SHOW_SEASON_LIMIT = 40;
const SHOW_COMPANY_LIMIT = 6;
const SHOW_EPISODE_LIMIT = 60;
const SHOW_RECOMMENDATION_LIMIT = 12;
const SHOW_SUMMARY_COLLECTION_LIMIT = 6;
const SHOW_ACTIVITY_PARENT_EVENT_LIMIT = 60;
const SHOW_ACTIVITY_EPISODE_EVENT_LIMIT = 100;
const SHOW_ACTIVITY_COLLECTION_EVENT_LIMIT = 60;
const SHOW_ACTIVITY_EPISODE_PROGRESS_LIMIT = 100;

type ShowSeasonRequest = ShowEntityRequest & { readonly seasonId: string };
type ShowEntityRequest = { readonly scope: ApiScope; readonly entityId: string };

const emptyShowSeasonEpisodesAtom = Atom.make<ShowSeasonEpisodesState>({ status: "loading" });

const showSummaryFamily = Atom.family((request: ShowEntityRequest) =>
	appClient(request.scope)
		.ryotql.query(
			showSummaryRecipe({
				entityId: request.entityId,
				collectionLimit: SHOW_SUMMARY_COLLECTION_LIMIT,
			}),
			{ reactivityKeys: scopedReactivityKey("show-summary", request.scope) },
		)
		.pipe(Atom.map(mapShowSummary)),
);

const showOverviewFamily = Atom.family((request: ShowEntityRequest) =>
	appClient(request.scope)
		.ryotql.query(
			showOverviewRecipe({
				entityId: request.entityId,
				peopleLimit: SHOW_PEOPLE_LIMIT,
				companyLimit: SHOW_COMPANY_LIMIT,
				recommendationLimit: SHOW_RECOMMENDATION_LIMIT,
			}),
			{ reactivityKeys: scopedReactivityKey("show-overview", request.scope) },
		)
		.pipe(Atom.map(mapShowOverview)),
);

const showEpisodesFamily = Atom.family((request: ShowEntityRequest) =>
	appClient(request.scope)
		.ryotql.query(
			showSeasonsRecipe({ entityId: request.entityId, seasonLimit: SHOW_SEASON_LIMIT }),
			{ reactivityKeys: scopedReactivityKey("show-episodes", request.scope) },
		)
		.pipe(Atom.map(mapShowEpisodes)),
);

const showSeasonEpisodesFamily = Atom.family((request: ShowSeasonRequest) =>
	appClient(request.scope)
		.ryotql.query(
			showSeasonEpisodesRecipe({ seasonId: request.seasonId, episodeLimit: SHOW_EPISODE_LIMIT }),
			{ reactivityKeys: scopedReactivityKey("show-episodes", request.scope) },
		)
		.pipe(Atom.map(mapShowSeasonEpisodes)),
);

const showActivityFamily = Atom.family((request: ShowEntityRequest) =>
	appClient(request.scope)
		.ryotql.query(
			showActivityRecipe({
				entityId: request.entityId,
				parentEventLimit: SHOW_ACTIVITY_PARENT_EVENT_LIMIT,
				episodeEventLimit: SHOW_ACTIVITY_EPISODE_EVENT_LIMIT,
				collectionEventLimit: SHOW_ACTIVITY_COLLECTION_EVENT_LIMIT,
				episodeProgressLimit: SHOW_ACTIVITY_EPISODE_PROGRESS_LIMIT,
			}),
			{ reactivityKeys: scopedReactivityKey("show-activity", request.scope) },
		)
		.pipe(Atom.map(mapShowActivity)),
);

export const showSummaryAtom = (request: ShowEntityRequest) =>
	showSummaryFamily({ entityId: request.entityId, scope: canonicalApiScope(request.scope) });

export const showOverviewAtom = (request: ShowEntityRequest) =>
	showOverviewFamily({ entityId: request.entityId, scope: canonicalApiScope(request.scope) });

export const showEpisodesAtom = (request: ShowEntityRequest) =>
	showEpisodesFamily({ entityId: request.entityId, scope: canonicalApiScope(request.scope) });

export const showSeasonEpisodesAtom = (
	request: ShowEntityRequest & { readonly seasonId: string | null },
) =>
	request.seasonId === null
		? emptyShowSeasonEpisodesAtom
		: showSeasonEpisodesFamily({
				entityId: request.entityId,
				seasonId: request.seasonId,
				scope: canonicalApiScope(request.scope),
			});

export const showActivityAtom = (request: ShowEntityRequest) =>
	showActivityFamily({ entityId: request.entityId, scope: canonicalApiScope(request.scope) });
