import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Effect } from "effect";

import { isNativePlatform } from "#/modules/navigation/native-navigation";

export const impactLight = () => {
	if (!isNativePlatform()) {
		return;
	}
	Effect.runFork(
		Effect.ignore(Effect.tryPromise(() => Haptics.impact({ style: ImpactStyle.Light }))),
	);
};

export const selectionChanged = () => {
	if (!isNativePlatform()) {
		return;
	}
	Effect.runFork(
		Effect.ignore(
			Effect.gen(function* () {
				yield* Effect.tryPromise(() => Haptics.selectionStart());
				yield* Effect.tryPromise(() => Haptics.selectionChanged());
				yield* Effect.tryPromise(() => Haptics.selectionEnd());
			}),
		),
	);
};
