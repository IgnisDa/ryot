import { buildNavigationDocument } from "@ryot/ryotql-recipes/navigation";
import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";
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

const navigationFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).query("ryotql", "execute", {
		payload: buildNavigationDocument(),

		reactivityKeys: scopedReactivityKey("navigation", scope),
	}),
);

export const navigationAtom = (scope: ApiScope) => navigationFamily(canonicalApiScope(scope));
