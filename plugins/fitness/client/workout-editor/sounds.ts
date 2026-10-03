import { Effect } from "@ryot-app/plugin-client-sdk/effect";

const soundSources = {
	check: new URL("./sounds/check.mp3", import.meta.url).href,
	"add-set": new URL("./sounds/add-set.mp3", import.meta.url).href,
	"timer-started": new URL("./sounds/timer-started.mp3", import.meta.url).href,
	"timer-completed": new URL("./sounds/timer-completed.mp3", import.meta.url).href,
} as const;

type WorkoutEditorSound = keyof typeof soundSources;
type SoundSource = Pick<
	AudioBufferSourceNode,
	"buffer" | "disconnect" | "start" | "stop" | "addEventListener"
>;
type SoundContext = Pick<
	AudioContext,
	"state" | "resume" | "close" | "suspend" | "decodeAudioData"
> & { createBufferSource: () => SoundSource };

// oxlint-disable-next-line effecttsgo/async-function -- Browser asset-fetch boundary; the plugin Effect surface does not expose HttpClient.
const loadSound = async (source: string) => {
	const response = await fetch(source);
	if (!response.ok) {
		throw new Error(`Sound request failed: ${response.status}`);
	}
	return response.arrayBuffer();
};

export const createWorkoutEditorSounds = (
	createContext: () => SoundContext = () => {
		const context = new AudioContext();
		return {
			close: () => context.close(),
			resume: () => context.resume(),
			suspend: () => context.suspend(),
			get state() {
				return context.state;
			},
			decodeAudioData: (data) => context.decodeAudioData(data),
			createBufferSource: () => {
				const source = context.createBufferSource();
				source.connect(context.destination);
				return source;
			},
		};
	},
	load: (source: string) => Effect.Effect<ArrayBuffer, unknown> = (source) =>
		Effect.tryPromise(() => loadSound(source)),
) => {
	const buffers = new Map<WorkoutEditorSound, AudioBuffer>();
	const sources = new Set<SoundSource>();
	let context: SoundContext | undefined;
	let disposed = false;
	const isDisposed = () => disposed;
	const resume = Effect.gen(function* () {
		if (disposed) {
			return undefined;
		}
		const current = yield* Effect.try(() => (context ??= createContext()));
		if (current.state !== "running") {
			yield* Effect.tryPromise(() => current.resume()).pipe(Effect.timeout("2 seconds"));
		}
		return current;
	});
	return {
		resume: resume.pipe(Effect.ignore),
		dispose: () => {
			if (disposed) {
				return Effect.void;
			}
			disposed = true;
			for (const source of sources) {
				source.stop();
				source.disconnect();
			}
			sources.clear();
			buffers.clear();
			const current = context;
			return current === undefined
				? Effect.void
				: Effect.tryPromise(() => current.close()).pipe(Effect.ignore);
		},
		play: (sound: WorkoutEditorSound, muted: boolean) =>
			Effect.gen(function* () {
				if (muted || isDisposed()) {
					return false;
				}
				const current = yield* resume;
				if (current === undefined) {
					return false;
				}
				let buffer = buffers.get(sound);
				if (buffer === undefined) {
					const data = yield* load(soundSources[sound]);
					buffer = yield* Effect.tryPromise(() => current.decodeAudioData(data));
					buffers.set(sound, buffer);
				}
				if (isDisposed()) {
					return false;
				}
				const decoded = buffer;
				const services = yield* Effect.context();
				return yield* Effect.try(() => {
					const source = current.createBufferSource();
					source.buffer = decoded;
					source.addEventListener(
						"ended",
						() => {
							sources.delete(source);
							source.disconnect();
							if (sources.size === 0 && !isDisposed()) {
								Effect.runForkWith(services)(
									Effect.tryPromise(() => current.suspend()).pipe(Effect.ignore),
								);
							}
						},
						{ once: true },
					);
					sources.add(source);
					source.start();
					return true;
				});
			}).pipe(Effect.orElseSucceed(() => false)),
	};
};
