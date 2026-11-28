import { mayHaveApplied } from "@ryot-app/plugin-client-contract";
import { createUuid } from "@ryot-app/ts-utils/uuid";
import { Cause, Effect, Exit } from "effect";
import { useState, useSyncExternalStore } from "react";

import { RyotClientError } from "../client/errors";
import type { RyotMutation } from "./definitions";
import { useRyotMutation } from "./hooks";
import { useRyotSchedule } from "./provider";
import { createRyotSubmission, type RyotSubmission } from "./submission";

const isOutcomeUnknown = (cause: Cause.Cause<unknown>) => {
	const error = Cause.squash(cause);
	return !(error instanceof RyotClientError) || mayHaveApplied(error.reason);
};

export const useRyotSubmission = <Input, Data, Failure extends Error>(
	definition: RyotMutation<RyotSubmission<Input>, Data, Failure>,
	options?: { readonly createId?: () => string },
) => {
	const schedule = useRyotSchedule();
	const [controller] = useState(() =>
		createRyotSubmission<Input>(options?.createId ?? createUuid, schedule.now),
	);
	const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
	const mutation = useRyotMutation(definition);
	const run = (submission: null | RyotSubmission<Input>) => {
		if (submission === null) {
			return;
		}
		schedule.run(
			Effect.andThen(Effect.yieldNow, mutation.mutateEffect(submission)).pipe(
				Effect.onExit((exit) =>
					Effect.sync(() =>
						controller.settle(Exit.isSuccess(exit) || !isOutcomeUnknown(exit.cause)),
					),
				),
				Effect.catchCause(() => Effect.void),
			),
			() => {},
		);
	};
	return {
		data: mutation.data,
		status: state.status,
		error: mutation.error,
		reset: mutation.reset,
		submission: state.submission,
		retry: () => run(controller.retry()),
		isPending: state.status === "pending",
		submit: (input: Input) => run(controller.start(input)),
		abandon: () => {
			if (controller.abandon()) {
				mutation.reset();
			}
		},
	};
};
