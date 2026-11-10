import { Effect } from "effect";

import { useRyotSchedule } from "./provider";

export const useHostScreen = () => {
	const schedule = useRyotSchedule();
	return <Outcome>(
		screen: Effect.Effect<Outcome, unknown>,
		onOutcome?: (outcome: Outcome) => void,
	) =>
		schedule.run(
			screen.pipe(
				Effect.tap((outcome) => Effect.sync(() => onOutcome?.(outcome))),
				Effect.ignore,
			),
			() => undefined,
		);
};
