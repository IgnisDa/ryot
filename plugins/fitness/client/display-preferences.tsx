import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

import { useFitnessMessages } from "./messages";
import { workoutEditorContextQuery } from "./workout-editor/context-query";
import type { WorkoutEditorContext } from "./workout-editor/controller-types";

export function DisplayPreferences(props: {
	readonly children: (context: WorkoutEditorContext) => ReactNode;
}) {
	const text = useFitnessMessages();
	const context = useRyotQuery(workoutEditorContextQuery, undefined);
	if (context.data !== undefined) {
		return props.children(context.data);
	}
	if (context.isError) {
		return (
			<>
				<StatusMessage tone="error">{text("client.preferences.load-failed")}</StatusMessage>
				<Button onClick={context.refetch}>{text("client.preferences.retry")}</Button>
			</>
		);
	}
	return <StatusMessage tone="pending">{text("client.preferences.loading")}</StatusMessage>;
}
