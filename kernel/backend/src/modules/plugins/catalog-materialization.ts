import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

export const publishAfterCatalogMaterialization = <E1, R1, E2, R2, E3, R3>(
	users: Effect.Effect<ReadonlyArray<UserId>, E1, R1>,
	materialize: (userId: UserId) => Effect.Effect<void, E2, R2>,
	publish: Effect.Effect<void, E3, R3>,
) =>
	Effect.gen(function* () {
		for (const userId of yield* users) {
			yield* materialize(userId);
		}
		yield* publish;
	});
