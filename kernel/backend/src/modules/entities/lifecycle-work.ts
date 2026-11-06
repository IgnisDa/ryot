import { Effect, Layer } from "effect";

import { LifecycleWork } from "#modules/automations/lifecycle/planning";

import { PluginMembershipWrites } from "./plugin-memberships";

/** Binds the writes a committed change derives in its transaction: plugin memberships. */
export const DeclaredLifecycleWorkLive = Layer.effect(
	LifecycleWork,
	Effect.map(PluginMembershipWrites, (memberships) =>
		LifecycleWork.of({ derive: memberships.derive }),
	),
);
