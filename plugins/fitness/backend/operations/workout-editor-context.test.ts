import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./workout-editor-context.sandbox";

it("returns trusted availability and own resolved settings without writing them", () => {
	const settings = {
		muteSounds: true,
		energyUnit: "kJ",
		dropRestTime: 20,
		normalRestTime: 0,
		warmUpRestTime: 10,
		failureRestTime: 30,
		unitSystem: "imperial",
		promptForRestTimer: false,
		startTimerForDurationExercises: true,
	};
	return Effect.runPromise(
		Effect.gen(function* () {
			const result = yield* definition.run(
				{},
				defineSandboxTestHost(manifest, {
					getUserSettings: () => Effect.succeed(settings),
					getProAvailability: () => Effect.succeed(false),
				}),
			);
			expect(result).toEqual({ settings, proAvailable: false });
		}),
	);
});
