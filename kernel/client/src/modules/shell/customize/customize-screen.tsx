import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import clsx from "clsx";

import { DemoProtectionMessage } from "#/modules/demo-protection";
import { CustomizePanel } from "#/modules/shell/customize/customize-panel";
import type { CustomizeSection } from "#/modules/shell/customize/customize-state";
import type { CustomizeDraftState } from "#/modules/shell/customize/use-customize-draft";

export function CustomizeScreen(props: {
	readonly onSave: () => void;
	readonly readOnly?: boolean;
	readonly onLeave: () => void;
	readonly customize: CustomizeDraftState;
	readonly initialSection?: undefined | CustomizeSection;
}) {
	const t = useT();
	const canSave = props.readOnly !== true && props.customize.isDirty && !props.customize.isSaving;
	return (
		<div className="flex h-full min-h-0 flex-col bg-bg">
			<div className="shrink-0 border-b border-border bg-surface pt-[max(env(safe-area-inset-top),0px)]">
				<div className="relative flex h-13.5 items-center justify-between px-4">
					<button
						type="button"
						onClick={props.onLeave}
						className="text-sm font-medium text-text-muted"
						aria-label={t(kernelMessage("client.shell.customize.cancel-label"))}
					>
						{t(kernelMessage("common.action.cancel"))}
					</button>
					<h1 className="pointer-events-none absolute inset-x-0 text-center font-display text-[19px] font-semibold text-text">
						{t(kernelMessage("client.shell.customize.title"))}
					</h1>
					<button
						type="button"
						disabled={!canSave}
						onClick={props.onSave}
						aria-label={t(kernelMessage("client.shell.customize.save-label"))}
						className={clsx(
							"text-sm font-medium",
							canSave ? "text-accent-text" : "text-text-subtle",
						)}
					>
						{t(
							kernelMessage(
								props.customize.isSaving ? "common.status.saving" : "common.action.save",
							),
						)}
					</button>
				</div>
			</div>
			{props.customize.error !== null && (
				<p role="alert" className="shrink-0 px-4 pt-3 text-xs text-danger">
					{t(props.customize.error)}
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
