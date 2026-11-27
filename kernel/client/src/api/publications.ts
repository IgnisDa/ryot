import type { ContractProgram, ContractRequest } from "@ryot-app/contract/client";
import {
	PUBLICATION_SESSION_HEADER,
	PublicationRateLimited,
	PublicationUnavailable,
} from "@ryot-app/contract/modules/publications/schemas";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpClient } from "effect/http";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ServerOrigin } from "#/api/origin";
import { runServerContract } from "#/api/public";
import type { ApiScope } from "#/api/scope";

export type PublicationVisitScope = {
	readonly origin: ServerOrigin;
	readonly sessionToken: string;
};

export class PublicationVisitApiError extends Schema.TaggedError<
	PublicationVisitApiError,
	{ readonly brand: unique symbol }
>()("PublicationVisitApiError", { cause: Schema.Unknown }) {}

export const isPublicationVisitFailure = Schema.is(
	Schema.Union([PublicationUnavailable, PublicationRateLimited]),
);

export class PublicationsApi extends Context.Service<PublicationsApi>()(
	"@ryot-app/kernel-client/api/publications/PublicationsApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				create: (scope: ApiScope, request: ContractRequest<"publications", "create">) =>
					api.run(scope, (client) => client.publications.create(request)),
				revoke: (scope: ApiScope, request: ContractRequest<"publications", "revoke">) =>
					api.run(scope, (client) => client.publications.revoke(request)),
				delete: (scope: ApiScope, request: ContractRequest<"publications", "delete">) =>
					api.run(scope, (client) => client.publications.delete(request)),
				status: (scope: ApiScope, request: ContractRequest<"publications", "status">) =>
					api.run(scope, (client) => client.publications.status(request)),
				preview: (scope: ApiScope, request: ContractRequest<"publications", "preview">) =>
					api.run(scope, (client) => client.publications.preview(request)),
				republish: (scope: ApiScope, request: ContractRequest<"publications", "republish">) =>
					api.run(scope, (client) => client.publications.republish(request)),
				createLink: (scope: ApiScope, request: ContractRequest<"publications", "createLink">) =>
					api.run(scope, (client) => client.publications.createLink(request)),
				revokeLink: (scope: ApiScope, request: ContractRequest<"publications", "revokeLink">) =>
					api.run(scope, (client) => client.publications.revokeLink(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export class PublicationVisitsApi extends Context.Service<PublicationVisitsApi>()(
	"@ryot-app/kernel-client/api/publications/PublicationVisitsApi",
	{
		make: Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient;
			const run = <A, E>(
				origin: ServerOrigin,
				headers: Record<string, string>,
				program: ContractProgram<A, E>,
			) =>
				runServerContract(http, origin, headers, program).pipe(
					Effect.mapError((cause) => new PublicationVisitApiError({ cause })),
				);
			const visit = <A, E>(scope: PublicationVisitScope, program: ContractProgram<A, E>) =>
				run(scope.origin, { [PUBLICATION_SESSION_HEADER]: scope.sessionToken }, program);
			return {
				page: (scope: PublicationVisitScope) =>
					visit(scope, (client) => client.publicationVisits.page()),
				ryotql: (
					scope: PublicationVisitScope,
					request: ContractRequest<"publicationVisits", "ryotql">,
				) => visit(scope, (client) => client.publicationVisits.ryotql(request)),
				assets: (
					scope: PublicationVisitScope,
					request: ContractRequest<"publicationVisits", "assets">,
				) => visit(scope, (client) => client.publicationVisits.assets(request)),
				exchange: (
					origin: ServerOrigin,
					request: ContractRequest<"publicationVisits", "exchange">,
				) => run(origin, {}, (client) => client.publicationVisits.exchange(request)),
				describe: (
					scope: PublicationVisitScope,
					request: ContractRequest<"publicationVisits", "describe">,
				) => visit(scope, (client) => client.publicationVisits.describe(request)),
				document: (
					scope: PublicationVisitScope,
					request: ContractRequest<"publicationVisits", "document">,
				) => visit(scope, (client) => client.publicationVisits.document(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
