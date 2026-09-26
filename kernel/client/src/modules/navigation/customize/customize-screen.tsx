import clsx from "clsx";

import { DemoProtectionMessage } from "#/modules/demo-protection";
import { CustomizePanel } from "#/modules/navigation/customize/customize-panel";
import type { CustomizeSection } from "#/modules/navigation/customize/customize-state";
import type { CustomizeDraftState } from "#/modules/navigation/customize/use-customize-draft";

export function CustomizeScreen(props: {
	readonly onSave: () => void;
	readonly onLeave: () => void;
	readonly customize: CustomizeDraftState;
	readonly readOnly?: boolean;
	readonly initialSection?: CustomizeSection | undefined;
}) {
	const canSave = props.readOnly !== true && props.customize.isDirty && !props.customize.isSaving;
	return (
		<div className="flex h-full min-h-0 flex-col bg-bg">
			<div className="shrink-0 border-b border-border bg-surface pt-[max(env(safe-area-inset-top),0px)]">
				<div className="relative flex h-13.5 items-center justify-between px-4">
					<button
						type="button"
						onClick={props.onLeave}
						aria-label="Cancel sidebar customization"
						className="text-sm font-medium text-text-muted"
					>
						Cancel
					</button>
					<h1 className="pointer-events-none absolute inset-x-0 text-center font-display text-[19px] font-semibold text-text">
						Customize sidebar
					</h1>
					<button
						type="button"
						disabled={!canSave}
						onClick={props.onSave}
						aria-label="Save sidebar changes"
						className={clsx(
							"text-sm font-medium",
							canSave ? "text-accent-text" : "text-text-subtle",
						)}
					>
						{props.customize.isSaving ? "Saving..." : "Save"}
					</button>
				</div>
			</div>
			{props.customize.error !== null && (
				<p role="alert" className="shrink-0 px-4 pt-3 text-xs text-danger">
					{props.customize.error}
				</p>
			)}
			{props.readOnly === true && (
				<div className="shrink-0 px-4 pt-3">
					<DemoProtectionMessage />
				</div>
			)}
			<CustomizePanel
				readOnly={props.readOnly}
				draft={props.customize.draft}
				onMove={props.customize.move}
				onToggle={props.customize.toggle}
				initialSection={props.initialSection}
			/>
		</div>
	);
}
