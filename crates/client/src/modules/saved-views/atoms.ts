import { savedViewRecordRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import {
	type ApiScope,
	canonicalApiScope,
	scopedReactivityKey,
	scopedRequestKey,
} from "@/api/request-key";
import { appStorageRuntime } from "@/persistence/storage";

import { emptySavedViewSession } from "./session-state";
import { mapSavedViewRecord } from "./state";
import { type SavedViewLayoutStorageScope, savedViewLayoutStorageKey } from "./storage";

type SavedViewRecordRequest = { readonly scope: ApiScope; readonly slug: string };

const savedViewRecordFamily = Atom.family((request: SavedViewRecordRequest) =>
	appClient(request.scope)
		.ryotql.query(savedViewRecordRecipe({ slug: request.slug }), {
			reactivityKeys: scopedReactivityKey("saved-view-record", request.scope),
		})
		.pipe(Atom.map(mapSavedViewRecord)),
);

export const savedViewRecordAtom = (request: SavedViewRecordRequest) =>
	savedViewRecordFamily({ scope: canonicalApiScope(request.scope), slug: request.slug });

const savedViewLayoutFamily = Atom.family((key: string) =>
	Atom.kvs({
		key,
		runtime: appStorageRuntime,
		defaultValue: () => "grid" as const,
		schema: Schema.Literals(["grid", "list", "table"]),
	}),
);

export const savedViewLayoutAtom = (scope: SavedViewLayoutStorageScope) =>
	savedViewLayoutFamily(savedViewLayoutStorageKey(scope));

const savedViewSessionFamily = Atom.family((_key: string) => Atom.make(emptySavedViewSession));

export const savedViewSessionAtom = (scope: ApiScope) =>
	savedViewSessionFamily(scopedRequestKey(scope, "saved-view-session"));
