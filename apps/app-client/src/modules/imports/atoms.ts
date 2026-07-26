import { importRunRecipe, manualImportRunsRecipe } from "@ryot/ryotql-recipes/import-runs";
import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";

export const IMPORT_RUNS_PAGE_SIZE = 20;
export const IMPORT_FAILURES_PAGE_SIZE = 25;

type ImportRunsRequest = { readonly scope: ApiScope; readonly limit: number };

type ImportRunRequest = {
	readonly runId: string;
	readonly scope: ApiScope;
	readonly failureLimit: number;
};

const importRunKeys = (scope: ApiScope) => scopedReactivityKey("import-runs", scope);

const importSourcesFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).query("imports", "listSources", {
		reactivityKeys: scopedReactivityKey("import-sources", scope),
	}),
);

const importRunsFamily = Atom.family((request: ImportRunsRequest) =>
	appClient(request.scope).ryotql.query(manualImportRunsRecipe({ limit: request.limit }), {
		reactivityKeys: importRunKeys(request.scope),
	}),
);

const importRunFamily = Atom.family((request: ImportRunRequest) =>
	appClient(request.scope).ryotql.query(
		importRunRecipe({ runId: request.runId, failureLimit: request.failureLimit }),
		{ reactivityKeys: importRunKeys(request.scope) },
	),
);

const deleteImportRunFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).mutation("imports", "deleteRun"),
);

export const importRunReactivityKeys = importRunKeys;

export const importSourcesAtom = (scope: ApiScope) => importSourcesFamily(canonicalApiScope(scope));

export const deleteImportRunAtom = (scope: ApiScope) =>
	deleteImportRunFamily(canonicalApiScope(scope));

export const importRunsAtom = (request: { scope: ApiScope; limit: number }) =>
	importRunsFamily({ limit: request.limit, scope: canonicalApiScope(request.scope) });

export const importRunAtom = (request: { runId: string; scope: ApiScope; failureLimit: number }) =>
	importRunFamily({
		runId: request.runId,
		failureLimit: request.failureLimit,
		scope: canonicalApiScope(request.scope),
	});
