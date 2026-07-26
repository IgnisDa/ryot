import { buildNavigationDocument } from "@ryot/ryotql-recipes/navigation";
import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appQueryClient } from "@/api/query-client";
import {
	type ApiScope,
	apiScopeKey,
	canonicalApiScope,
	keyedRequestFamily,
	scopedReactivityKey,
} from "@/api/request-key";
import { appStorageRuntime } from "@/persistence/storage";

import { type WorkspaceStorageScope, workspaceStorageKey } from "./storage";

const workspaceAtom = Atom.family((scopeKey: string) =>
	Atom.kvs({
		key: scopeKey,
		schema: Schema.String,
		runtime: appStorageRuntime,
		defaultValue: () => "media",
	}),
);

export const scopedWorkspaceAtom = (scope: WorkspaceStorageScope) =>
	workspaceAtom(workspaceStorageKey(scope));

export const navigationAtom = keyedRequestFamily(apiScopeKey, (scope: ApiScope) => {
	const canonical = canonicalApiScope(scope);
	return appQueryClient(canonical.serverUrl).query("ryotql", "execute", {
		payload: buildNavigationDocument(),
		reactivityKeys: scopedReactivityKey("navigation", canonical),
	});
});
