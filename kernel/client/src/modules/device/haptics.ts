import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Effect } from "effect";

import { isNativePlatform } from "#/modules/navigation/native-navigation";

export const impactHaptic = Effect.suspend(() =>
	isNativePlatform()
		? Effect.ignoreCause(Effect.promise(() => Haptics.impact({ style: ImpactStyle.Light })))
		: Effect.void,
);

export const selectionHaptic = Effect.suspend(() =>
	isNativePlatform()
		? Effect.ignoreCause(
				Effect.gen(function* () {
					yield* Effect.promise(() => Haptics.selectionStart());
					yield* Effect.promise(() => Haptics.selectionChanged());
					yield* Effect.promise(() => Haptics.selectionEnd());
				}),
			)
		: Effect.void,
);
