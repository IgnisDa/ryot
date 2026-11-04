import { Effect, Layer } from "effect";

import { LifecycleWork } from "#modules/automations/lifecycle/planning";
import { BackgroundWorkService } from "#modules/background-work/service";
import { EventStreamWorkService } from "#modules/events/stream-work";
import { RelationshipProjectionService } from "#modules/relationships/projections/service";

import { PluginMembershipWrites } from "./plugin-memberships";

/** Binds the work a committed change admits or derives in its transaction: event streams, relationship projection inputs, and plugin memberships. */
export const DeclaredLifecycleWorkLive = Layer.effect(
	LifecycleWork,
	Effect.gen(function* () {
		const streams = yield* EventStreamWorkService;
		const projections = yield* RelationshipProjectionService;
		const memberships = yield* PluginMembershipWrites;
		const background = yield* BackgroundWorkService;
		return LifecycleWork.of({
			derive: memberships.derive,
			dispatch: (ids) => Effect.forEach(ids, (id) => background.dispatch(id), { discard: true }),
			admit: (triggers) =>
				Effect.map(
					Effect.all([streams.admitChanges(triggers), projections.admitInputs(triggers)]),
					([events, relationships]) => [...events, ...relationships],
				),
		});
	}),
);
