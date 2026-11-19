import { Button, Card, EmptyState, Skeleton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import { useFitnessMessages } from "../messages";
import type { WorkoutEditorContext, WorkoutEditorControllerSnapshot } from "./controller-types";

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
	readonly onStart: (template: boolean) => void;
	readonly snapshot: WorkoutEditorControllerSnapshot;
	readonly context: undefined | WorkoutEditorContext;
}) {
	const text = useFitnessMessages();
	const { context, snapshot } = props;
	return (
		<>
			{snapshot.status === "loading" ? (
				<EditorSkeleton label={text("client.editor.recovering")} />
			) : null}
			{props.preparing ? <EditorSkeleton label={text("client.editor.preparing")} /> : null}
			{context === undefined &&
			snapshot.contextError === undefined &&
			snapshot.status !== "loading" ? (
				<EditorSkeleton label={text("client.editor.loading-settings")} />
			) : null}
			{snapshot.status === "empty" && !props.saved && !props.requested ? (
				<EmptyState
					title={text("client.editor.empty-title")}
					icon={<AppIcon size={20} name="dumbbell" />}
					description={text("client.editor.empty-description")}
					action={
						<div className="grid w-72 max-w-full gap-2">
							<Button
								size="lg"
								disabled={context === undefined}
								onClick={() => props.onStart(false)}
							>
								{text("client.home.start-empty")}
							</Button>
							<Button
								variant="secondary"
								disabled={!context?.pro}
								onClick={() => props.onStart(true)}
							>
								<AppIcon size={15} name="layers-3" />
								{text("client.home.setup.template-action")}
							</Button>
							{context !== undefined && !context.pro ? (
								<p className="text-xs text-text-muted">{text("client.editor.templates-pro")}</p>
							) : null}
						</div>
					}
				/>
			) : null}
		</>
	);
}
