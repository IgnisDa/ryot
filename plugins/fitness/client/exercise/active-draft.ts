import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePageRefresh } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useMemo, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	decodeWorkoutEditorDraft,
	type WorkoutEditorMode,
} from "../../shared/workout-editor-draft";
import { DRAFT_STORAGE_KEY } from "../workout-editor/draft-storage";

export type ActiveEditorDraft = {
	readonly name: string;
	readonly totalSets: number;
	readonly confirmedSets: number;
	readonly mode: WorkoutEditorMode;
	readonly startedAt: string | undefined;
	readonly exerciseIds: readonly string[];
};

const addToDraftLabels: Record<WorkoutEditorMode["kind"], string> = {
	historical: "Add to workout",
	live: "Add to current workout",
	"template-edit": "Add to current template",
	"template-create": "Add to current template",
};

export const addToDraftLabel = (mode: WorkoutEditorMode) => addToDraftLabels[mode.kind];

const activeDraftOf = (value: unknown): undefined | ActiveEditorDraft => {
	if (value === null || value === undefined) {
		return undefined;
	}
	const decoded = decodeWorkoutEditorDraft(value);
	if (
		decoded._tag === "Failure" ||
		decoded.success.submission !== undefined ||
		decoded.success.endedAt !== undefined
	) {
		return undefined;
	}
	const sets = decoded.success.occurrences.flatMap((occurrence) =>
		occurrence.sets.filter(({ included }) => included),
	);
	return {
		totalSets: sets.length,
		mode: decoded.success.mode,
		name: decoded.success.name,
		startedAt: decoded.success.startedAt,
		exerciseIds: decoded.success.occurrences.map(({ exerciseId }) => exerciseId),
		confirmedSets: sets.filter(({ confirmedAt }) => confirmedAt !== undefined).length,
	};
};

export function useActiveEditorDraft() {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const [active, setActive] = useState<ActiveEditorDraft>();
	const read = useMemo(
		() =>
			client.storage
				.get(client.pluginIdentity(PLUGIN_PACKAGE_ID).pluginId, DRAFT_STORAGE_KEY)
				.pipe(
					Effect.match({
						onFailure: () => setActive(undefined),
						onSuccess: (value) => setActive(activeDraftOf(value)),
					}),
				),
		[client],
	);
	useEffect(() => schedule.run(read, () => undefined), [read, schedule]);
	usePageRefresh(() => read);
	return active;
}
