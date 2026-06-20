import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { RunStatus } from "@ryot-app/contract/schema/run-status";
import clsx from "clsx";

import { runStatusPill, type RunStatusTone } from "#/modules/ui/run/run-status";

const toneClassName: Record<RunStatusTone, string> = {
	info: "text-info",
	danger: "text-danger",
	success: "text-success",
	muted: "text-text-muted",
};

export function RunStatusPill(props: { readonly status: RunStatus }) {
	const pill = runStatusPill(props.status);
	return (
		<span className="flex h-6 items-center gap-1.5 rounded-full border border-border px-2">
			<AppIcon size={12} name={pill.icon} className={toneClassName[pill.tone]} />
			<span className={clsx("text-[11px] font-medium", toneClassName[pill.tone])}>
				{pill.label}
			</span>
		</span>
	);
}

export function RunStatusGlyph(props: { readonly status: RunStatus }) {
	const pill = runStatusPill(props.status);
	return (
		<span role="img" aria-label={pill.label} className="shrink-0">
			<AppIcon size={16} name={pill.icon} className={toneClassName[pill.tone]} />
		</span>
	);
}
