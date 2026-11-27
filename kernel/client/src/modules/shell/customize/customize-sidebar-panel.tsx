import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import { DemoProtectionMessage } from "#/modules/demo-protection";
import { CustomizePanel } from "#/modules/shell/customize/customize-panel";
import type { CustomizeSection } from "#/modules/shell/customize/customize-state";
import type { CustomizeDraftState } from "#/modules/shell/customize/use-customize-draft";

export function CustomizeSidebarPanel(props: {
	readonly onSave: () => void;
	readonly readOnly?: boolean;
	readonly onLeave: () => void;
	readonly customize: CustomizeDraftState;
	readonly initialSection?: undefined | CustomizeSection;
}) {
	const t = useT();
	const canSave = props.readOnly !== true && props.customize.isDirty && !props.customize.isSaving;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<h1 className="font-display text-base font-semibold text-text">
						{t(kernelMessage("client.shell.customize.title"))}
					</h1>
					<p className="text-xs leading-5 text-text-muted">
						{t(kernelMessage("client.shell.customize.subtitle"))}
					</p>
				</div>
				<button
					type="button"
					onClick={props.onLeave}
					aria-label={t(kernelMessage("client.shell.customize.close-label"))}
					className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text"
				>
					<AppIcon name="x" size={18} />
				</button>
			</div>
			<CustomizePanel
				readOnly={props.readOnly}
				draft={props.customize.draft}
				onMove={props.customize.move}
				onToggle={props.customize.toggle}
				initialSection={props.initialSection}
			/>
			<div className="flex shrink-0 flex-col gap-2.5 border-t border-border p-3">
				{props.readOnly === true && <DemoProtectionMessage />}
				{props.customize.error !== null && (
					<p role="alert" className="text-xs text-danger">
						{t(props.customize.error)}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={props.onLeave}
						aria-label={t(kernelMessage("client.shell.customize.cancel-label"))}
						className="rounded-lg px-3 py-2 text-sm font-medium text-text-muted"
					>
						{t(kernelMessage("common.action.cancel"))}
					</button>
					<button
						type="button"
						disabled={!canSave}
						onClick={props.onSave}
						aria-label={t(kernelMessage("client.shell.customize.save-label"))}
						className={clsx(
							"rounded-lg px-3 py-2 text-sm font-medium",
							canSave ? "bg-accent text-accent-ink" : "bg-surface-2 text-text-subtle",
						)}
					>
						{t(
							props.customize.isSaving
								? kernelMessage("common.status.saving")
								: kernelMessage("common.action.save-changes"),
						)}
					</button>
				</div>
			</div>
		</div>
	);
}
