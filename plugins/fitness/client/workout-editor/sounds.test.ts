import { Deferred, Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import { createWorkoutEditorSounds } from "./sounds";

type CreateContext = NonNullable<Parameters<typeof createWorkoutEditorSounds>[0]>;
type SoundContext = ReturnType<CreateContext>;
type SoundSource = ReturnType<SoundContext["createBufferSource"]>;
type LoadSound = NonNullable<Parameters<typeof createWorkoutEditorSounds>[1]>;
type WorkoutEditorSounds = ReturnType<typeof createWorkoutEditorSounds>;

const createFakeContext = (
	initialState: AudioContextState = "running",
	resumeBehavior?: (setRunning: () => void, calls: number) => Promise<void>,
) => {
	let state = initialState;
	const sources: SoundSource[] = [];
	const endings: EventTarget[] = [];
	const record = {
		sources,
		endings,
		stopCalls: 0,
		closeCalls: 0,
		startCalls: 0,
		decodeCalls: 0,
		resumeCalls: 0,
		suspendCalls: 0,
		disconnectCalls: 0,
	};
	const audioBuffer: AudioBuffer = {
		length: 1,
		duration: 1,
		sampleRate: 1,
		numberOfChannels: 1,
		copyToChannel: () => undefined,
		copyFromChannel: () => undefined,
		getChannelData: () => new Float32Array(1),
	};
	const context: SoundContext = {
		get state() {
			return state;
		},
		close: () => {
			record.closeCalls += 1;
			return Promise.resolve();
		},
		decodeAudioData: () => {
			record.decodeCalls += 1;
			return Promise.resolve(audioBuffer);
		},
		suspend: () => {
			record.suspendCalls += 1;
			state = "suspended";
			return Promise.resolve();
		},
		resume: () => {
			record.resumeCalls += 1;
			if (resumeBehavior !== undefined) {
				return resumeBehavior(() => {
					state = "running";
				}, record.resumeCalls);
			}
			state = "running";
			return Promise.resolve();
		},
		createBufferSource: () => {
			const events = new EventTarget();
			record.endings.push(events);
			const source: SoundSource = {
				buffer: null,
				stop: () => {
					record.stopCalls += 1;
				},
				start: () => {
					record.startCalls += 1;
				},
				addEventListener: events.addEventListener.bind(events),
				disconnect: () => {
					record.disconnectCalls += 1;
				},
			};
			record.sources.push(source);
			return source;
		},
	};
	return {
		record,
		context,
		setState: (next: AudioContextState) => {
			state = next;
		},
	};
};

const createSounds = (createContext: CreateContext, loadedSources: string[]): WorkoutEditorSounds =>
	createWorkoutEditorSounds(createContext, (source) => {
		loadedSources.push(source);
		return Effect.succeed(new ArrayBuffer(1));
	});

describe("workout editor sounds", () => {
	it("does not create a context or load sounds while muted or disposed", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fake = createFakeContext();
				const loadedSources: string[] = [];
				let contextCreations = 0;
				const sounds = createSounds(() => {
					contextCreations += 1;
					return fake.context;
				}, loadedSources);

				expect(yield* sounds.play("add-set", true)).toBe(false);
				yield* sounds.dispose();
				expect(yield* sounds.play("add-set", false)).toBe(false);
				expect(contextCreations).toBe(0);
				expect(loadedSources).toHaveLength(0);
			}),
		));

	it("resumes the shared context after an interruption before playing another sound", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fake = createFakeContext();
				const loadedSources: string[] = [];
				let contextCreations = 0;
				const sounds = createSounds(() => {
					contextCreations += 1;
					return fake.context;
				}, loadedSources);

				expect(yield* sounds.play("check", false)).toBe(true);
				fake.setState("suspended");
				expect(yield* sounds.play("add-set", false)).toBe(true);
				expect(contextCreations).toBe(1);
				expect(fake.record.resumeCalls).toBe(1);
				expect(loadedSources).toHaveLength(2);
				expect(fake.record.startCalls).toBe(2);
			}),
		));

	it("suspends the context once the last sound ends and resumes it for the next one", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fake = createFakeContext();
				const sounds = createSounds(() => fake.context, []);

				expect(yield* sounds.play("check", false)).toBe(true);
				expect(yield* sounds.play("add-set", false)).toBe(true);
				fake.record.endings[0]?.dispatchEvent(new Event("ended"));
				expect(fake.record.suspendCalls).toBe(0);
				fake.record.endings[1]?.dispatchEvent(new Event("ended"));
				yield* Effect.yieldNow;
				expect(fake.record.suspendCalls).toBe(1);

				expect(yield* sounds.play("check", false)).toBe(true);
				expect(fake.record.resumeCalls).toBe(1);
				expect(fake.record.startCalls).toBe(3);
			}),
		));

	it("caches loading and decoding while creating a new source for each play", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fake = createFakeContext();
				const loadedSources: string[] = [];
				const sounds = createSounds(() => fake.context, loadedSources);

				expect(yield* sounds.play("delete-set", true)).toBe(false);
				expect(loadedSources).toHaveLength(0);
				expect(yield* sounds.play("delete-set", false)).toBe(true);
				expect(yield* sounds.play("delete-set", false)).toBe(true);
				expect(loadedSources).toHaveLength(1);
				expect(fake.record.decodeCalls).toBe(1);
				expect(fake.record.sources).toHaveLength(2);
				expect(new Set(fake.record.sources).size).toBe(2);
				expect(fake.record.startCalls).toBe(2);
			}),
		));

	it("returns false after a resume failure and plays after a successful retry", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fake = createFakeContext("suspended", (setRunning, calls) => {
					if (calls === 1) {
						return Promise.reject("resume failed");
					}
					setRunning();
					return Promise.resolve();
				});
				const loadedSources: string[] = [];
				const sounds = createSounds(() => fake.context, loadedSources);

				expect(yield* sounds.play("check", false)).toBe(false);
				expect(yield* sounds.play("check", false)).toBe(true);
				expect(fake.record.resumeCalls).toBe(2);
				expect(loadedSources).toHaveLength(1);
				expect(fake.record.startCalls).toBe(1);
			}),
		));

	it("stops active sources and closes the context on dispose", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fake = createFakeContext();
				const loadedSources: string[] = [];
				let contextCreations = 0;
				const sounds = createSounds(() => {
					contextCreations += 1;
					return fake.context;
				}, loadedSources);

				expect(yield* sounds.play("timer-completed", false)).toBe(true);
				yield* sounds.dispose();

				expect(fake.record.stopCalls).toBe(1);
				expect(fake.record.disconnectCalls).toBe(1);
				expect(fake.record.closeCalls).toBe(1);
				expect(yield* sounds.play("timer-completed", false)).toBe(false);
				expect(contextCreations).toBe(1);
				expect(loadedSources).toHaveLength(1);
				expect(fake.record.startCalls).toBe(1);
			}),
		));

	it("does not start a source when loading completes after dispose", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const release = yield* Deferred.make<ArrayBuffer>();
				const fake = createFakeContext();
				const load: LoadSound = () =>
					Effect.gen(function* () {
						yield* Deferred.succeed(started, undefined);
						return yield* Deferred.await(release);
					});
				const sounds = createWorkoutEditorSounds(() => fake.context, load);
				const playing = yield* Effect.forkChild(sounds.play("check", false), {
					startImmediately: true,
				});

				yield* Deferred.await(started);
				yield* sounds.dispose();
				yield* Deferred.succeed(release, new ArrayBuffer(1));

				expect(yield* Fiber.join(playing)).toBe(false);
				expect(fake.record.sources).toHaveLength(0);
				expect(fake.record.startCalls).toBe(0);
			}),
		));
});
