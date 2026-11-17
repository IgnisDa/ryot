import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import { useFitnessMessages } from "../messages";
import type { PickerExercise } from "./picker-model";

export function PickerSelectionTray(props: {
	readonly disabled: boolean;
	readonly replacing: boolean;
	readonly onApply: () => void;
	readonly applyLabel?: string | undefined;
	readonly selected: readonly PickerExercise[];
	readonly onRemove: (exercise: PickerExercise) => void;
}) {
	const text = useFitnessMessages();
	const { selected, replacing } = props;
	return (
		<>
			<div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
				<p aria-live="polite" className="sr-only">
					{text("client.picker.selected", { count: selected.length })}
				</p>
				{selected.length === 0 ? (
					<span className="text-sm text-text-muted">
						{replacing ? text("client.picker.choose-one") : text("client.picker.nothing")}
					</span>
				) : (
					<ul
						aria-label={text("client.picker.selected-label")}
						className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]"
					>
						{selected.map((exercise) => (
							<li key={exercise.id} className="shrink-0">
								<button
									type="button"
									onClick={() => props.onRemove(exercise)}
									aria-label={text("client.picker.remove", { name: exercise.name })}
									className="inline-flex h-8 max-w-44 items-center gap-1.5 rounded-pill border border-accent-border bg-accent-soft px-3 text-[13px] font-medium text-accent-text pointer-coarse:h-10"
								>
									<span className="truncate">{exercise.name}</span>
									<AppIcon name="x" size={13} />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
			<Button
				className="flex-none"
				onClick={props.onApply}
				disabled={selected.length === 0 || props.disabled}
			>
				{replacing
					? (props.applyLabel ?? text("client.card.replace"))
					: text("client.picker.add-count", { count: selected.length })}
			</Button>
		</>
	);
}
