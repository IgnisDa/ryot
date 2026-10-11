import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { describe, expect, it } from "vitest";

import { createWorkoutEditorSounds } from "./sounds";

describe("workout editor sounds", () => {
	it("does not create or play audio while muted", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let creations = 0;
				const sounds = createWorkoutEditorSounds(() => {
					creations += 1;
					return { currentTime: 0, pause: () => undefined, play: () => Promise.resolve() };
				});

				expect(yield* sounds.play("add-set", true)).toBe(false);
				expect(creations).toBe(0);
			}),
		));

	it("returns false when the browser rejects playback", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let playCalls = 0;
				const sounds = createWorkoutEditorSounds(() => ({
					currentTime: 0,
					pause: () => undefined,
					play: () => {
						playCalls += 1;
						return Promise.reject(new Error("autoplay blocked"));
					},
				}));

				expect(yield* sounds.play("check", false)).toBe(false);
				expect(playCalls).toBe(1);
			}),
		));

	it("halts and releases created audio on dispose", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let creations = 0;
				let playCalls = 0;
				let pauseCalls = 0;
				const sounds = createWorkoutEditorSounds(() => {
					creations += 1;
					return {
						currentTime: 0,
						pause: () => {
							pauseCalls += 1;
						},
						play: () => {
							playCalls += 1;
							return Promise.resolve();
						},
					};
				});

				expect(yield* sounds.play("timer-started", false)).toBe(true);
				sounds.dispose();

				expect(pauseCalls).toBe(1);
				expect(yield* sounds.play("timer-started", false)).toBe(false);
				expect(creations).toBe(1);
				expect(playCalls).toBe(1);
			}),
		));
});
