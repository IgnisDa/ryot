import { showOverviewRecipe, showSummaryRecipe } from "@ryot/media-plugin/query-recipes";
import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";

import { mapShowOverview } from "./show-overview-state";
import { mapShowSummary } from "./show-summary-state";

const SHOW_PEOPLE_LIMIT = 12;

const SHOW_COMPANY_LIMIT = 6;

const SHOW_RECOMMENDATION_LIMIT = 12;

const SHOW_SUMMARY_COLLECTION_LIMIT = 6;

type ShowEntityRequest = { readonly scope: ApiScope; readonly entityId: string };

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

export const showSummaryAtom = (request: ShowEntityRequest) =>
	showSummaryFamily({ entityId: request.entityId, scope: canonicalApiScope(request.scope) });

export const showOverviewAtom = (request: ShowEntityRequest) =>
	showOverviewFamily({ entityId: request.entityId, scope: canonicalApiScope(request.scope) });
