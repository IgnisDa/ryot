import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { AutomationRunStatus } from "@ryot-app/contract/modules/automations/lifecycle";
import clsx from "clsx";

const statuses = {
	queued: { icon: "clock", label: "Queued", tone: "text-text-muted" },
	running: { label: "Running", tone: "text-info", icon: "rotate-ccw" },
	failed: { label: "Failed", tone: "text-danger", icon: "circle-alert" },
	rejected: { icon: "circle-x", label: "Rejected", tone: "text-danger" },
	skipped: { icon: "circle", label: "Skipped", tone: "text-text-muted" },
	succeeded: { label: "Succeeded", icon: "circle-check", tone: "text-success" },
} as const satisfies Record<AutomationRunStatus, { icon: string; label: string; tone: string }>;

export function AutomationStatusPill(props: { readonly status: AutomationRunStatus }) {
	const status = statuses[props.status];
	return (
		<span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border px-2">
			<AppIcon size={12} name={status.icon} className={status.tone} />
			<span className={clsx("text-[11px] font-medium", status.tone)}>{status.label}</span>
		</span>
	);
}

export function AutomationStatusGlyph(props: { readonly status: AutomationRunStatus }) {
	const status = statuses[props.status];
	return (
		<span role="img" className="shrink-0" aria-label={status.label}>
			<AppIcon size={16} name={status.icon} className={status.tone} />
		</span>
	);
}
