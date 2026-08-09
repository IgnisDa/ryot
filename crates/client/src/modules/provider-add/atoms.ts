import type { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { SandboxProviderId as SandboxProviderIdSchema } from "@ryot-app/contract/schema/brands";
import { providerEntityLinksRecipe } from "@ryot-app/ryotql-recipes/provider-entity-links";
import { providerSearchRecipe } from "@ryot-app/ryotql-recipes/provider-search";
import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";
import { appStorageRuntime } from "@/persistence/storage";

import {
	type ProviderAddProviderStorageScope,
	providerAddProviderStorageKey,
} from "./provider-storage";

type ProviderSearchRequest = ApiScope & { rootEntitySchemaSlug: EntitySchemaSlug };

type ProviderEntityLinksRequest = ApiScope & {
	readonly providerId: SandboxProviderId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly externalIds: readonly [string, ...string[]];
};

const canonicalProviderEntityLinksRequest = (request: ProviderEntityLinksRequest) => {
	const [first, ...rest] = [...request.externalIds].sort();
	return {
		providerId: request.providerId,
		scope: canonicalApiScope(request),
		externalIds: [first, ...rest] as const,
		entitySchemaSlug: request.entitySchemaSlug,
	};
};

const providerSearchFamily = Atom.family((request: ProviderSearchRequest) =>
	appClient(request).ryotql.query(
		providerSearchRecipe({
			rootEntitySchemaSlug: request.rootEntitySchemaSlug,
		}),
		{
			reactivityKeys: scopedReactivityKey("provider-search", request),
		},
	),
);

export const providerSearchAtom = (request: ProviderSearchRequest) =>
	providerSearchFamily({
		...canonicalApiScope(request),
		rootEntitySchemaSlug: request.rootEntitySchemaSlug,
	});

const providerEntityLinksFamily = Atom.family(
	(request: ReturnType<typeof canonicalProviderEntityLinksRequest>) =>
		appClient(request.scope).ryotql.query(
			providerEntityLinksRecipe({
				providerId: request.providerId,
				externalIds: request.externalIds,
				entitySchemaSlug: request.entitySchemaSlug,
			}),
			{
				reactivityKeys: scopedReactivityKey("provider-entity-links", request.scope),
			},
		),
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
