import { Effect } from "effect";
import { useState, useSyncExternalStore } from "react";

import type { RyotMutation } from "./definitions";
import { useRyotMutation } from "./hooks";
import { useRyotSchedule } from "./provider";
import { createRyotSubmission, type RyotSubmission } from "./submission";

export const useRyotSubmission = <Input, Data, HostServices, Failure extends Error>(
	definition: RyotMutation<RyotSubmission<Input>, Data, HostServices, Failure>,
	options?: { readonly createId?: () => string; readonly isComplete?: (data: Data) => boolean },
) => {
	const schedule = useRyotSchedule();
	const [controller] = useState(() =>
		createRyotSubmission<Input>(options?.createId ?? (() => crypto.randomUUID()), schedule.now),
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
						controller.settle(
							exit._tag === "Success" && (options?.isComplete?.(exit.value) ?? true),
						),
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
