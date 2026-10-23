import { Button, Card, EmptyState, Skeleton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import type { WorkoutEditorControllerSnapshot } from "./controller-types";

export function EditorSkeleton(props: { readonly label: string }) {
	return (
		<div role="status" className="grid gap-3" aria-label={props.label}>
			<Skeleton className="h-6 w-3/5" />
			{[0, 1].map((index) => (
				<Card key={index} className="grid gap-2.5">
					<div className="flex items-center gap-2.5">
						<Skeleton className="size-10 rounded-md" />
						<div className="grid flex-1 gap-1.5">
							<Skeleton className="h-3.5 w-2/3" />
							<Skeleton className="h-2.5 w-2/5" />
						</div>
					</div>
					<Skeleton className="h-9 pointer-coarse:h-11" />
					<Skeleton className="h-9 pointer-coarse:h-11" />
				</Card>
			))}
		</div>
	);
}

export function EditorStates(props: {
	readonly saved: boolean;
	readonly preparing: boolean;
	readonly requested: boolean;
	readonly snapshot: WorkoutEditorControllerSnapshot;
	readonly context: typeof WorkoutEditorContextOutputSchema.Type | undefined;
	readonly onStart: (template: boolean) => void;
}) {
	const { context, snapshot } = props;
	return (
		<>
			{snapshot.status === "loading" ? <EditorSkeleton label="Recovering your workout" /> : null}
			{props.preparing ? <EditorSkeleton label="Preparing workout editor" /> : null}
			{context === undefined &&
			snapshot.contextError === undefined &&
			snapshot.status !== "loading" ? (
				<EditorSkeleton label="Loading Fitness settings" />
			) : null}
			{snapshot.status === "empty" && !props.saved && !props.requested ? (
				<EmptyState
					title="No workout in progress"
					icon={<AppIcon size={20} name="dumbbell" />}
					description="Start an empty workout and add exercises as you go, or plan a reusable template."
					action={
						<div className="grid w-72 max-w-full gap-2">
							<Button
								size="lg"
								disabled={context === undefined}
								onClick={() => props.onStart(false)}
							>
								Start empty workout
							</Button>
							<Button
								variant="secondary"
								disabled={!context?.proAvailable}
								onClick={() => props.onStart(true)}
							>
								<AppIcon size={15} name="layers-3" />
								New template
							</Button>
							{context !== undefined && !context.proAvailable ? (
								<p className="text-xs text-text-muted">Templates require Pro.</p>
							) : null}
						</div>
					}
				/>
			) : null}
		</>
	);
}
