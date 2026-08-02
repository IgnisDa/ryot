import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ProviderEntitySearchService } from "./search-service";
import { EntityImportService } from "./service";

export const ProviderEntitiesRoutesLive = HttpApiBuilder.group(
	AppContract,
	"providerEntities",
	(handlers) =>
		handlers
			.handle("search", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* ProviderEntitySearchService;
					return yield* service.search(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("import", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityImportService;
					return yield* service.import(user, payload).pipe(dieOnDbError);
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
