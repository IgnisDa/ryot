import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";

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
