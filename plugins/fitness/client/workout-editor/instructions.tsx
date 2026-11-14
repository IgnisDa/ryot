import { ManagedAssetProvider, useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import { Button, Field, TextArea } from "@ryot-app/plugin-ui-sdk";

import type { WorkoutEditorOccurrence } from "../../shared/workout-editor-draft";
import type { WorkoutSetAssetLocator } from "../../shared/workout-set";
import { managedAssetBatch } from "../asset-urls";
import { EditorSheet } from "./editor-sheet";
import type { EditorExercise } from "./queries";

export function ExerciseNotesSheet(props: {
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly exercise: undefined | EditorExercise;
	readonly onNotes: (notes: readonly string[]) => void;
}) {
	return (
		<EditorSheet
			wide="side"
			onClose={props.onClose}
			title="Instructions and notes"
			closeLabel="Close instructions and notes"
			footer={<Button onClick={props.onClose}>Done</Button>}
			description={props.exercise?.name ?? "Unavailable exercise"}
		>
			<div className="grid gap-5">
				<section className="grid gap-2">
					<h3 className="text-[11px] font-semibold tracking-wider text-text-subtle uppercase">
						How to perform
					</h3>
					<ExerciseInstructions exercise={props.exercise} />
				</section>
				<Field
					label="Notes for this workout"
					hint="Saved with this workout. Set notes live on each set."
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
			<ManagedAssetProvider assets={managedAssetBatch(images)}>
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
				<p className="text-sm text-text-subtle">No instructions are available.</p>
			)}
		</div>
	);
}

function DemonstrationImage(props: {
	readonly name: string;
	readonly image: WorkoutSetAssetLocator;
}) {
	const url = useAssetUrl(props.image);
	return url === undefined ? null : (
		<img
			src={url}
			loading="lazy"
			alt={`${props.name} demonstration`}
			className="h-40 w-40 rounded-lg bg-surface-2 object-contain"
		/>
	);
}
