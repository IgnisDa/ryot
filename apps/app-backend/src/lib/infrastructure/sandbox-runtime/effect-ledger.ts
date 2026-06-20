import { Effect } from "effect";

import type { AutomationsService } from "#modules/automations/service";

type AutomationEffectService = Pick<AutomationsService, "finishEffect" | "reserveEffect">;

export const reserveAutomationEffect = Effect.fn("reserveAutomationEffect")(function* <E>(input: {
	runId: string;
	hostFunction: string;
	correlationId: string;
	validatedInput: unknown;
	correlationUnits: number;
	effectKey: string | undefined;
	mapError: (error: unknown) => E;
	missingEffectKeyMessage: string;
	automations: AutomationEffectService;
}) {
	if (!input.effectKey?.trim()) {
		return yield* Effect.fail(input.mapError(input.missingEffectKeyMessage));
	}

	const reservation = yield* input.automations
		.reserveEffect({
			runId: input.runId,
			hostFunction: input.hostFunction,
			effectKey: input.effectKey.trim(),
			correlationId: input.correlationId,
			validatedInput: input.validatedInput,
			correlationUnits: input.correlationUnits,
		})
		.pipe(Effect.mapError(input.mapError));
	if (reservation.kind === "existing" && reservation.effect.status !== "pending") {
		return { kind: "existing" as const, result: reservation.effect.result };
	}

	return { kind: "reserved" as const, effectId: reservation.effect.id };
});

export const finishAutomationEffect = Effect.fn("finishAutomationEffect")(function* <E>(input: {
	result: unknown;
	effectId: string;
	mapError: (error: unknown) => E;
	automations: AutomationEffectService;
	downstreamExecutionId?: string | undefined;
}) {
	yield* input.automations
		.finishEffect({
			id: input.effectId,
			status: "accepted",
			result: input.result,
			downstreamExecutionId: input.downstreamExecutionId,
		})
		.pipe(Effect.mapError(input.mapError));
});
