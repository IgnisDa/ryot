import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import type { DbError } from "@ryot-app/contract/errors";
import { ProviderEntityInternalError } from "@ryot-app/contract/modules/provider-entities/schemas";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ProviderEntitySearchService } from "./search-service";
import { EntityImportService } from "./service";

const mapProviderEntityDbError = <A, E, R>(effect: Effect.Effect<A, E | DbError, R>) =>
	effect.pipe(
		Effect.catchTag("DbError", (error) =>
			Effect.logError("provider entity request failed", error).pipe(
				Effect.andThen(new ProviderEntityInternalError({ reason: { code: "unexpected-error" } })),
			),
		),
	);

export const ProviderEntitiesRoutesLive = HttpApiBuilder.group(
	AppContract,
	"providerEntities",
	(handlers) =>
		handlers
			.handle("search", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* ProviderEntitySearchService;
					return yield* mapProviderEntityDbError(service.search(user, payload));
				}),
			)
			.handle("searchOptions", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* ProviderEntitySearchService;
					return {
						schema: yield* service
							.resolveSearchOptionsSchema(user, payload.providerId)
							.pipe(mapProviderEntityDbError),
					};
				}),
			)
			.handle("import", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityImportService;
					return yield* mapProviderEntityDbError(service.import(user, payload));
				}),
			)
			.handle("getImportResult", ({ params }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityImportService;
					return yield* service.getImportResult(user, params.jobId);
				}),
			),
);
