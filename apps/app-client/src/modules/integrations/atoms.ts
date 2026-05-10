import { IntegrationId } from "@ryot/contract/schema/brands";
import { integrationImportRunsRecipe } from "@ryot/ryotql-recipes/import-runs";
import { integrationRecipe, integrationsRecipe } from "@ryot/ryotql-recipes/integrations";
import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";

export const INTEGRATIONS_PAGE_SIZE = 20;
export const INTEGRATION_RUNS_PAGE_SIZE = 10;

type IntegrationsRequest = { readonly scope: ApiScope; readonly limit: number };

type IntegrationRequest = { readonly id: string; readonly scope: ApiScope };

type IntegrationRunsRequest = {
	readonly limit: number;
	readonly scope: ApiScope;
	readonly integrationId: string;
};

const integrationKeys = (scope: ApiScope) => scopedReactivityKey("integrations", scope);

const integrationProvidersFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).query("integrations", "listProviders", {
		reactivityKeys: scopedReactivityKey("integration-providers", scope),
	}),
);

const integrationsFamily = Atom.family((request: IntegrationsRequest) =>
	appClient(request.scope).ryotql.query(integrationsRecipe({ limit: request.limit }), {
		reactivityKeys: integrationKeys(request.scope),
	}),
);

const integrationSummaryFamily = Atom.family((request: IntegrationRequest) =>
	appClient(request.scope).ryotql.query(integrationRecipe({ id: request.id }), {
		reactivityKeys: integrationKeys(request.scope),
	}),
);

const integrationRunsFamily = Atom.family((request: IntegrationRunsRequest) =>
	appClient(request.scope).ryotql.query(
		integrationImportRunsRecipe({ limit: request.limit, integrationId: request.integrationId }),
		{ reactivityKeys: integrationKeys(request.scope) },
	),
);

const integrationDetailFamily = Atom.family((request: IntegrationRequest) =>
	appClient(request.scope).query("integrations", "get", {
		reactivityKeys: integrationKeys(request.scope),
		params: { integrationId: IntegrationId.make(request.id) },
	}),
);

const createIntegrationFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).mutation("integrations", "create"),
);

const updateIntegrationFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).mutation("integrations", "update"),
);

const deleteIntegrationFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).mutation("integrations", "delete"),
);

export const integrationReactivityKeys = integrationKeys;

export const integrationProvidersAtom = (scope: ApiScope) =>
	integrationProvidersFamily(canonicalApiScope(scope));

export const createIntegrationAtom = (scope: ApiScope) =>
	createIntegrationFamily(canonicalApiScope(scope));

export const updateIntegrationAtom = (scope: ApiScope) =>
	updateIntegrationFamily(canonicalApiScope(scope));

export const deleteIntegrationAtom = (scope: ApiScope) =>
	deleteIntegrationFamily(canonicalApiScope(scope));

export const integrationsAtom = (request: { scope: ApiScope; limit: number }) =>
	integrationsFamily({ limit: request.limit, scope: canonicalApiScope(request.scope) });

export const integrationSummaryAtom = (request: { id: string; scope: ApiScope }) =>
	integrationSummaryFamily({ id: request.id, scope: canonicalApiScope(request.scope) });

export const integrationDetailAtom = (request: { id: string; scope: ApiScope }) =>
	integrationDetailFamily({ id: request.id, scope: canonicalApiScope(request.scope) });

export const integrationRunsAtom = (request: {
	limit: number;
	scope: ApiScope;
	integrationId: string;
}) =>
	integrationRunsFamily({
		limit: request.limit,
		integrationId: request.integrationId,
		scope: canonicalApiScope(request.scope),
	});
