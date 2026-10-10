import { Schema } from "@ryot-app/plugin-client-sdk/effect";
import { ManagedAssetProvider } from "@ryot-app/plugin-client-sdk/react";

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
		<div className="my-3 flex flex-col gap-3">
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
				<ol className="list-inside list-decimal space-y-2 text-sm text-text-subtle">
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
