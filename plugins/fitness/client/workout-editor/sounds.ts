import { Effect } from "@ryot-app/plugin-client-sdk/effect";

const soundSources = {
	check: new URL("./sounds/check.mp3", import.meta.url).href,
	"add-set": new URL("./sounds/add-set.mp3", import.meta.url).href,
	"timer-started": new URL("./sounds/timer-started.mp3", import.meta.url).href,
	"timer-completed": new URL("./sounds/timer-completed.mp3", import.meta.url).href,
} as const;

type WorkoutEditorSound = keyof typeof soundSources;

type AudioPlayer = Pick<HTMLMediaElement, "currentTime" | "play" | "pause">;

type AudioPlayerFactory = (source: string) => AudioPlayer;

export const createWorkoutEditorSounds = (
	createAudio: AudioPlayerFactory = (source) => new Audio(source),
) => {
	const players = new Map<WorkoutEditorSound, AudioPlayer>();
	let disposed = false;

	return {
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			for (const player of players.values()) {
				player.pause();
			}
			players.clear();
		},
		play: (sound: WorkoutEditorSound, muted: boolean) =>
			Effect.gen(function* () {
				if (muted || disposed) {
					return false;
				}
				const player = players.get(sound) ?? createAudio(soundSources[sound]);
				players.set(sound, player);
				player.currentTime = 0;
				return yield* Effect.tryPromise({ catch: () => false, try: () => player.play() }).pipe(
					Effect.map(() => true),
					Effect.orElseSucceed(() => false),
				);
			}),
	};
};
