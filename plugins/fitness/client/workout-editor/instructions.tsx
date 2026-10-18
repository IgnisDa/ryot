import { Schema } from "@ryot-app/plugin-client-sdk/effect";
import { ManagedAssetProvider } from "@ryot-app/plugin-client-sdk/react";
import { Button, Dialog, Field, TextArea } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import type { WorkoutEditorOccurrence } from "../../shared/workout-editor-draft";
import { WorkoutEditorMediaSchema, type WorkoutSetAssetLocator } from "../../shared/workout-set";
import { managedAssetBatch, useAssetUrl } from "../asset-urls";
import type { EditorExercise } from "./queries";

const instructionsSchema = Schema.Array(Schema.String);

function DemonstrationImage(props: {
	readonly image: WorkoutSetAssetLocator;
	readonly name: string;
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

export function ExerciseInstructions(props: { readonly exercise: EditorExercise | undefined }) {
	if (props.exercise === undefined) {
		return null;
	}
	const { exercise } = props;
	const images = Schema.decodeUnknownResult(WorkoutEditorMediaSchema)(
		exercise.properties["images"] ?? [],
	);
	const instructions = Schema.decodeUnknownResult(instructionsSchema)(
		exercise.properties["instructions"] ?? [],
	);
	const imageKeyCounts = new Map<string, number>();
	const imageItems =
		images._tag === "Success"
			? images.success.map((image) => {
					const locator = image.type === "remote" ? image.url : image.key;
					const baseKey = JSON.stringify([image.type, locator]);
					const occurrence = imageKeyCounts.get(baseKey) ?? 0;
					imageKeyCounts.set(baseKey, occurrence + 1);
					return { image, key: JSON.stringify([baseKey, occurrence]) };
				})
			: [];
	const instructionKeyCounts = new Map<string, number>();
	const instructionItems =
		instructions._tag === "Success"
			? instructions.success.map((instruction) => {
					const occurrence = instructionKeyCounts.get(instruction) ?? 0;
					instructionKeyCounts.set(instruction, occurrence + 1);
					return { instruction, key: JSON.stringify([instruction, occurrence]) };
				})
			: [];
	return (
		<div className="flex flex-col gap-3">
			{images._tag === "Success" ? (
				<ManagedAssetProvider assets={managedAssetBatch(images.success)}>
					<div className="flex gap-3 overflow-x-auto">
						{imageItems.map(({ key, image }) => (
							<DemonstrationImage key={key} image={image} name={exercise.name} />
						))}
					</div>
				</ManagedAssetProvider>
			) : null}
			{instructions._tag === "Success" && instructions.success.length > 0 ? (
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

export function ExerciseNotesSheet(props: {
	readonly compact: boolean;
	readonly disabled: boolean;
	readonly safeAreaBottom: number;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly exercise: EditorExercise | undefined;
	readonly onNotes: (notes: readonly string[]) => void;
	readonly onClose: () => void;
}) {
	return (
		<Dialog
			onClose={props.onClose}
			title="Instructions and notes"
			safeAreaBottom={props.safeAreaBottom}
			closeLabel="Close instructions and notes"
			closeIcon={<AppIcon name="x" size={18} />}
			placement={props.compact ? "sheet" : "side"}
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
		</Dialog>
	);
}
