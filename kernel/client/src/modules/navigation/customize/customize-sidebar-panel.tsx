import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";

import { CustomizePanel } from "#/modules/navigation/customize/customize-panel";
import type { CustomizeSection } from "#/modules/navigation/customize/customize-state";
import type { CustomizeDraftState } from "#/modules/navigation/customize/use-customize-draft";

export function CustomizeSidebarPanel(props: {
	readonly onSave: () => void;
	readonly onLeave: () => void;
	readonly customize: CustomizeDraftState;
	readonly initialSection?: CustomizeSection | undefined;
}) {
	const canSave = props.customize.isDirty && !props.customize.isSaving;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<h1 className="font-display text-base font-semibold text-text">Customize sidebar</h1>
					<p className="text-xs leading-5 text-text-muted">
						Reorder and choose which workspaces and views appear in your sidebar.
					</p>
				</div>
				<button
					type="button"
					onClick={props.onLeave}
					aria-label="Close customize sidebar"
					className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text"
				>
					<AppIcon name="x" size={18} />
				</button>
			</div>
			<CustomizePanel
				draft={props.customize.draft}
				onMove={props.customize.move}
				onToggle={props.customize.toggle}
				initialSection={props.initialSection}
			/>
			<div className="flex shrink-0 flex-col gap-2.5 border-t border-border p-3">
				{props.customize.error !== null && (
					<p role="alert" className="text-xs text-danger">
						{props.customize.error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={props.onLeave}
						aria-label="Cancel sidebar customization"
						className="rounded-lg px-3 py-2 text-sm font-medium text-text-muted"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={!canSave}
						onClick={props.onSave}
						aria-label="Save sidebar changes"
						className={clsx(
							"rounded-lg px-3 py-2 text-sm font-medium",
							canSave ? "bg-accent text-accent-ink" : "bg-surface-2 text-text-subtle",
						)}
					>
						{props.customize.isSaving ? "Saving..." : "Save changes"}
					</button>
				</div>
			</div>
		</div>
	);
}
