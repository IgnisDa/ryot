import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

import type { WorkoutEditorContextOutputSchema } from "../shared/workout-editor-context-operations";
import { workoutEditorContextQuery } from "./workout-editor/context-query";

export function DisplayPreferences(props: {
	readonly children: (context: typeof WorkoutEditorContextOutputSchema.Type) => ReactNode;
}) {
	const context = useRyotQuery(workoutEditorContextQuery, undefined);
	if (context.data !== undefined) {
		return props.children(context.data);
	}
	if (context.isError) {
		return (
			<>
				<StatusMessage tone="error">Display preferences could not be loaded.</StatusMessage>
				<Button onClick={context.refetch}>Retry preferences</Button>
			</>
		);
	}
	return <StatusMessage tone="pending">Loading display preferences…</StatusMessage>;
}
