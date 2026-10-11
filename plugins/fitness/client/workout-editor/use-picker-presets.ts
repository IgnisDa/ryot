import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { maxPickerPresets, PickerPresetsSchema, type PickerPreset } from "./picker-model";

const PRESETS_STORAGE_KEY = "fitness-workout-exercise-picker-presets";

export function usePickerPresets() {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const { pluginId } = client.pluginIdentity(PLUGIN_PACKAGE_ID);
	const writing = useRef(false);
	const [presets, setPresets] = useState<readonly PickerPreset[]>([]);
	const [status, setStatus] = useState<"error" | "loading" | "ready">("loading");
	const [writeError, setWriteError] = useState(false);
	const [pendingWrite, setPendingWrite] = useState<readonly PickerPreset[] | null>(null);

	const reload = useCallback(
		() =>
			schedule.run(
				Effect.gen(function* () {
					setStatus("loading");
					const stored = yield* client.storage.get(pluginId, PRESETS_STORAGE_KEY);
					if (stored === null) {
						return [];
					}
					return yield* Schema.decodeUnknownEffect(PickerPresetsSchema)(stored).pipe(
						Effect.mapError(() => new RyotClientError("malformed-result")),
					);
				}).pipe(
					Effect.match({
						onFailure: () => setStatus("error"),
						onSuccess: (value) => {
							setPresets(value);
							setStatus("ready");
						},
					}),
				),
				() => undefined,
			),
		[client, pluginId, schedule],
	);

	useEffect(() => reload(), [reload]);

	const persist = (next: readonly PickerPreset[]) => {
		if (writing.current) {
			return false;
		}
		writing.current = true;
		setPendingWrite(next);
		setWriteError(false);
		schedule.run(
			Schema.encodeEffect(PickerPresetsSchema)(next).pipe(
				Effect.flatMap((encoded) => client.storage.set(pluginId, PRESETS_STORAGE_KEY, encoded)),
				Effect.match({
					onFailure: () => setWriteError(true),
					onSuccess: () => {
						setPresets(next);
						setPendingWrite(null);
					},
				}),
			),
			() => {
				writing.current = false;
			},
		);
		return true;
	};

	return {
		status,
		reload,
		presets,
		writeError,
		full: presets.length >= maxPickerPresets,
		canWrite: status === "ready" && pendingWrite === null,
		retryWrite: () => {
			if (pendingWrite !== null) {
				persist(pendingWrite);
			}
		},
		add: (preset: PickerPreset) =>
			presets.length < maxPickerPresets && persist([...presets, preset]),
		remove: (id: string) => {
			const next = presets.filter((preset) => preset.id !== id);
			return next.length !== presets.length && persist(next);
		},
	};
}
