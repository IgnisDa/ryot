import type { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { SandboxProviderId as SandboxProviderIdSchema } from "@ryot/contract/schema/brands";
import { buildProviderEntityLinksDocument } from "@ryot/ryotql-recipes/provider-entity-links";
import { buildProviderSearchDocument } from "@ryot/ryotql-recipes/provider-search";
import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appQueryClient } from "@/api/query-client";
import {
	type ApiScope,
	canonicalApiScope,
	keyedRequestFamily,
	scopedReactivityKey,
	scopedRequestKey,
} from "@/api/request-key";
import { appStorageRuntime } from "@/persistence/storage";

import {
	type ProviderAddProviderStorageScope,
	providerAddProviderStorageKey,
} from "./provider-storage";

type ProviderSearchRequest = ApiScope & { rootEntitySchemaSlug: EntitySchemaSlug };

type ProviderEntityLinksRequest = ApiScope & {
	readonly providerId: SandboxProviderId;
	readonly externalIds: readonly [string, ...string[]];
};

const canonicalProviderEntityLinksRequest = (request: ProviderEntityLinksRequest) => {
	const [first, ...rest] = [...request.externalIds].sort();
	const externalIds = [first, ...rest] as const;
	return {
		externalIds,
		providerId: request.providerId,
		scope: canonicalApiScope(request),
		key: scopedRequestKey(request, request.providerId, externalIds),
	};
};

export const providerSearchAtom = keyedRequestFamily(
	(request: ProviderSearchRequest) =>
		scopedRequestKey(request, "provider-search", request.rootEntitySchemaSlug),
	(request: ProviderSearchRequest) =>
		appQueryClient(request.serverUrl).query("ryotql", "execute", {
			reactivityKeys: scopedReactivityKey("provider-search", request),
			payload: buildProviderSearchDocument({
				rootEntitySchemaSlug: request.rootEntitySchemaSlug,
			}),
		}),
);

const providerEntityLinksFamily = keyedRequestFamily(
	(request: ReturnType<typeof canonicalProviderEntityLinksRequest>) => request.key,
	(request: ReturnType<typeof canonicalProviderEntityLinksRequest>) =>
		appQueryClient(request.scope.serverUrl).query("ryotql", "execute", {
			reactivityKeys: scopedReactivityKey("provider-entity-links", request.scope),
			payload: buildProviderEntityLinksDocument({
				providerId: request.providerId,
				externalIds: request.externalIds,
			}),
		}),
);

export const providerEntityLinksAtom = (request: ProviderEntityLinksRequest) =>
	providerEntityLinksFamily(canonicalProviderEntityLinksRequest(request));

const rememberedProviderFamily = Atom.family((key: string) =>
	Atom.kvs({
		key,
		runtime: appStorageRuntime,
		defaultValue: (): SandboxProviderId | null => null,
		schema: Schema.NullOr(SandboxProviderIdSchema),
	}),
);

export const rememberedProviderAtom = (scope: ProviderAddProviderStorageScope) =>
	rememberedProviderFamily(providerAddProviderStorageKey(scope));
