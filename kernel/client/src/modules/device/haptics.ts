import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Effect } from "effect";

import { isNativePlatform } from "#/modules/navigation/native-navigation";

export const lightImpact = Effect.suspend(() =>
	isNativePlatform()
		? Effect.ignore(Effect.tryPromise(() => Haptics.impact({ style: ImpactStyle.Light })))
		: Effect.void,
);

export const impactLight = () => {
	Effect.runFork(lightImpact);
};

export const selectionChange = Effect.suspend(() =>
	isNativePlatform()
		? Effect.ignore(
				Effect.gen(function* () {
					yield* Effect.tryPromise(() => Haptics.selectionStart());
					yield* Effect.tryPromise(() => Haptics.selectionChanged());
					yield* Effect.tryPromise(() => Haptics.selectionEnd());
				}),
			)
		: Effect.void,
);

export const selectionChanged = () => Effect.runFork(selectionChange);
