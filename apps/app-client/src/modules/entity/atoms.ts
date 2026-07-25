import { showSummaryRecipe } from "@ryot/media-plugin/query-recipes";
import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";

import { mapShowSummary } from "./show-summary-state";

const SHOW_SUMMARY_COLLECTION_LIMIT = 6;

type ShowSummaryRequest = { readonly scope: ApiScope; readonly entityId: string };

const showSummaryFamily = Atom.family((request: ShowSummaryRequest) =>
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

export const showSummaryAtom = (request: ShowSummaryRequest) =>
	showSummaryFamily({
		entityId: request.entityId,
		scope: canonicalApiScope(request.scope),
	});
