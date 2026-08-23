import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

export const publishAfterCatalogMaterialization = <E1, R1, E2, R2, E3, R3, E4, R4>(
	users: Effect.Effect<ReadonlyArray<UserId>, E1, R1>,
	refreshViews: (userId: UserId) => Effect.Effect<void, E2, R2>,
	materialize: (userId: UserId) => Effect.Effect<void, E3, R3>,
	publish: Effect.Effect<void, E4, R4>,
) =>
	Effect.gen(function* () {
		for (const userId of yield* users) {
			yield* refreshViews(userId);
			yield* materialize(userId);
		}
		yield* publish;
	});
