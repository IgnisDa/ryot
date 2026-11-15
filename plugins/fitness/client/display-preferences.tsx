import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

import { workoutEditorContextQuery } from "./workout-editor/context-query";
import type { WorkoutEditorContext } from "./workout-editor/controller-types";

export function DisplayPreferences(props: {
	readonly children: (context: WorkoutEditorContext) => ReactNode;
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
