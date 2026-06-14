import { HttpApiBuilder } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { MetadataLookupService } from "./service";

export const MetadataLookupRoutesLive = HttpApiBuilder.group(
	AppContract,
	"metadataLookup",
	(handlers) =>
		handlers.handle("lookup", ({ path, payload }) =>
			Effect.gen(function* () {
				const service = yield* MetadataLookupService;
				return yield* service.lookup(path.integrationId, payload).pipe(dieOnDbError);
			}),
		),
);
