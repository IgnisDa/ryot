import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { AutomationsRepository } from "./repository";

export class AutomationsService extends Context.Service<AutomationsService>()(
	"AutomationsService",
	{
		make: Effect.gen(function* () {
			const repository = yield* AutomationsRepository;
			const countByUser = Effect.fn("AutomationsService.countByUser")(function* (userId: UserId) {
				return yield* repository.countByUser(userId);
			});
			return { countByUser };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
