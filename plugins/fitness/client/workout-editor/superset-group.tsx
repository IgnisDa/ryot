import { MotionList } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ReactNode } from "react";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
} from "../../shared/workout-editor-draft";
import { supersetColorVariable, supersetName } from "../group-colors";
import { supersetOf } from "./draft-ops";

type Superset = WorkoutEditorDraft["supersets"][number];

type OccurrenceSegment = {
	readonly occurrences: WorkoutEditorOccurrence[];
	readonly group: undefined | (Superset & { readonly name: string });
};

export const supersetNames = (draft: WorkoutEditorDraft) => {
	const names = new Map<string, string>();
	for (const occurrence of draft.occurrences) {
		const group = supersetOf(draft, occurrence.clientId);
		if (group !== undefined && !names.has(group.clientId)) {
			names.set(group.clientId, supersetName(names.size));
		}
	}
	return names;
};

export const occurrenceSegments = (draft: WorkoutEditorDraft) => {
	const names = supersetNames(draft);
	const segments: OccurrenceSegment[] = [];
	for (const occurrence of draft.occurrences) {
		const group = supersetOf(draft, occurrence.clientId);
		const last = segments.at(-1);
		if (group !== undefined && last?.group?.clientId === group.clientId) {
			last.occurrences.push(occurrence);
		} else {
			segments.push({
				occurrences: [occurrence],
				group:
					group === undefined ? undefined : { ...group, name: names.get(group.clientId) ?? "" },
			});
		}
	}
	return segments;
};

export function SupersetGroup(props: {
	readonly name: string;
	readonly color: string;
	readonly count: number;
	readonly children: ReactNode;
}) {
	const color = supersetColorVariable(props.color);
	return (
		<section aria-label={props.name} className="relative grid gap-2 pl-3.5">
			<span
				aria-hidden="true"
				style={{ backgroundColor: color }}
				className="absolute top-8 bottom-1.5 left-0.5 w-0.75 rounded-pill"
			/>
			<div className="flex min-h-7 items-center gap-2">
				<span
					style={{ color }}
					className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase"
				>
					<AppIcon size={13} name="link" />
					{props.name}
				</span>
				<span className="text-xs text-text-muted">Alternate · {props.count} exercises</span>
			</div>
			<MotionList className="grid gap-2">{props.children}</MotionList>
		</section>
	);
}
