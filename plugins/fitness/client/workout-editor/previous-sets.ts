import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { DateTime } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery, useRyotQuery, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useState } from "react";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { historySetForOccurrence, previousSetIndex } from "./history-model";
import { readPreviousSets } from "./queries";

type PreviousSetsInput = Parameters<typeof readPreviousSets>[1] & { readonly count: number };

const previousSetsQuery = createRyotQuery(
	({ input, client }: { readonly client: RyotClient; readonly input: PreviousSetsInput }) =>
		readPreviousSets(client, input, input.count),
);

const previousSetsInput = (
	draft: WorkoutEditorDraft,
	occurrence: WorkoutEditorOccurrence,
	fallbackStartedAt: string,
) => {
	const last = occurrence.sets.at(-1);
	return {
		exerciseId: occurrence.exerciseId,
		recordedKind: occurrence.exerciseKind,
		beforeStartedAt: draft.startedAt ?? fallbackStartedAt,
		excludeWorkoutId: draft.mode.kind === "historical" ? draft.mode.entityId : "",
		count:
			last === undefined
				? 0
				: previousSetIndex(draft.occurrences, occurrence.clientId, last.clientId) + 1,
	};
};

export const usePreviousSets = (
	draft: WorkoutEditorDraft,
	occurrence: WorkoutEditorOccurrence,
): ReadonlyMap<string, WorkoutEditorSet> => {
	const schedule = useRyotSchedule();
	const [fallbackStartedAt] = useState(() =>
		DateTime.formatIso(DateTime.makeUnsafe(schedule.now())),
	);
	const result = useRyotQuery(
		previousSetsQuery,
		previousSetsInput(draft, occurrence, fallbackStartedAt),
		{ refreshOnMutation: false },
	);
	const [lastRows, setLastRows] = useState(result.data);
	if (result.data !== undefined && result.data !== lastRows) {
		setLastRows(result.data);
	}
	const rows = result.data ?? lastRows ?? [];
	return new Map(
		occurrence.sets.flatMap((set) => {
			const row = rows[previousSetIndex(draft.occurrences, occurrence.clientId, set.clientId)];
			const previous =
				row === undefined ? undefined : historySetForOccurrence(row, occurrence, set.clientId);
			return previous === undefined ? [] : [[set.clientId, previous] as const];
		}),
	);
};
