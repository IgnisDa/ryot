import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import type { PickerExercise } from "./picker-model";

export function PickerSelectionTray(props: {
	readonly replacing: boolean;
	readonly disabled: boolean;
	readonly applyLabel?: string | undefined;
	readonly onApply: () => void;
	readonly selected: readonly PickerExercise[];
	readonly onRemove: (exercise: PickerExercise) => void;
}) {
	const { selected, replacing } = props;
	return (
		<>
			<div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
				<p aria-live="polite" className="sr-only">
					{selected.length} selected
				</p>
				{selected.length === 0 ? (
					<span className="text-sm text-text-muted">
						{replacing ? "Choose one exercise" : "Nothing selected"}
					</span>
				) : (
					<ul
						aria-label="Selected exercises"
						className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]"
					>
						{selected.map((exercise) => (
							<li key={exercise.id} className="shrink-0">
								<button
									type="button"
									aria-label={`Remove ${exercise.name}`}
									onClick={() => props.onRemove(exercise)}
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
					? (props.applyLabel ?? "Replace exercise")
					: `Add ${selected.length} ${selected.length === 1 ? "exercise" : "exercises"}`}
			</Button>
		</>
	);
}
