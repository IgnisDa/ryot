import {
	collectManagedAssetLocators,
	ManagedAssetProvider,
	useAssetUrl,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Field, TextArea } from "@ryot-app/plugin-ui-sdk";

import type { WorkoutEditorOccurrence } from "../../shared/workout-editor-draft";
import type { WorkoutSetAssetLocator } from "../../shared/workout-set";
import { useFitnessMessages } from "../messages";
import { EditorSheet } from "./editor-sheet";
import type { EditorExercise } from "./queries";

export function ExerciseNotesSheet(props: {
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly exercise: undefined | EditorExercise;
	readonly onNotes: (notes: readonly string[]) => void;
}) {
	const text = useFitnessMessages();
	return (
		<EditorSheet
			wide="side"
			onClose={props.onClose}
			title={text("client.card.notes")}
			closeLabel={text("client.instructions.close")}
			footer={<Button onClick={props.onClose}>{text("common.action.done")}</Button>}
			description={props.exercise?.name ?? text("client.overlays.exercise-unavailable")}
		>
			<div className="grid gap-5">
				<section className="grid gap-2">
					<h3 className="text-[11px] font-semibold tracking-wider text-text-subtle uppercase">
						{text("client.exercise.instructions.title")}
					</h3>
					<ExerciseInstructions exercise={props.exercise} />
				</section>
				<Field
					hint={text("client.instructions.notes-hint")}
					label={text("client.instructions.notes-label")}
				>
					{(control) => (
						<TextArea
							{...control}
							rows={4}
							disabled={props.disabled}
							value={props.occurrence.notes.join("\n")}
							onChange={(event) => props.onNotes(event.target.value.split("\n"))}
						/>
					)}
				</Field>
			</div>
		</EditorSheet>
	);
}

export function ExerciseInstructions(props: { readonly exercise: undefined | EditorExercise }) {
	const text = useFitnessMessages();
	if (props.exercise === undefined) {
		return null;
	}
	const { exercise } = props;
	const images = exercise.images ?? [];
	const instructions = exercise.instructions ?? [];
	const imageKeyCounts = new Map<string, number>();
	const imageItems = images.map((image) => {
		const locator = image.type === "remote" ? image.url : image.key;
		const baseKey = JSON.stringify([image.type, locator]);
		const occurrence = imageKeyCounts.get(baseKey) ?? 0;
		imageKeyCounts.set(baseKey, occurrence + 1);
		return { image, key: JSON.stringify([baseKey, occurrence]) };
	});
	const instructionKeyCounts = new Map<string, number>();
	const instructionItems = instructions.map((instruction) => {
		const occurrence = instructionKeyCounts.get(instruction) ?? 0;
		instructionKeyCounts.set(instruction, occurrence + 1);
		return { instruction, key: JSON.stringify([instruction, occurrence]) };
	});
	return (
		<div className="flex flex-col gap-3">
			<ManagedAssetProvider assets={collectManagedAssetLocators(images)}>
				<div className="flex gap-3 overflow-x-auto">
					{imageItems.map(({ key, image }) => (
						<DemonstrationImage key={key} image={image} name={exercise.name} />
					))}
				</div>
			</ManagedAssetProvider>
			{instructionItems.length > 0 ? (
				<ol className="list-decimal space-y-2 pl-5 text-sm text-text">
					{instructionItems.map(({ key, instruction }) => (
						<li key={key}>{instruction}</li>
					))}
				</ol>
			) : (
				<p className="text-sm text-text-subtle">{text("client.instructions.none")}</p>
			)}
		</div>
	);
}

function DemonstrationImage(props: {
	readonly name: string;
	readonly image: WorkoutSetAssetLocator;
}) {
	const text = useFitnessMessages();
	const url = useAssetUrl(props.image);
	return url === undefined ? null : (
		<img
			src={url}
			loading="lazy"
			className="h-40 w-40 rounded-lg bg-surface-2 object-contain"
			alt={text("client.instructions.demonstration", { name: props.name })}
		/>
	);
}
