import { Collapse } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type {
	AssistantStepStatus,
	AssistantTranscriptStep,
} from "@ryot-app/ryotql-recipes/assistant";
import clsx from "clsx";
import { useId, useState } from "react";

import { stepDetail, stepTitle } from "./presentation";

const spinning = "animate-spin text-accent-text motion-reduce:animate-none";
const statusIcons = {
	done: { name: "check", label: "Done", className: "text-success" },
	running: { label: "Running", className: spinning, name: "loader-circle" },
	declined: { name: "x", label: "Declined", className: "text-text-subtle" },
	failed: { label: "Failed", name: "circle-alert", className: "text-danger" },
	interrupted: { name: "square", label: "Stopped", className: "text-text-subtle" },
} as const satisfies Record<
	AssistantStepStatus,
	{ readonly name: string; readonly label: string; readonly className: string }
>;

export function AssistantSteps(props: {
	readonly live: boolean;
	readonly summary: string;
	readonly steps: readonly AssistantTranscriptStep[];
}) {
	const [expanded, setExpanded] = useState(false);
	const listId = useId();
	const open = props.live || expanded;
	return (
		<div className="rounded-lg border border-border-card bg-surface text-label">
			<button
				type="button"
				aria-expanded={open}
				disabled={props.live}
				aria-controls={listId}
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-muted"
			>
				<AppIcon
					size={14}
					name={props.live ? "loader-circle" : "check"}
					className={props.live ? spinning : "text-success"}
				/>
				<span className="min-w-0 flex-1 truncate">{props.summary}</span>
				{props.live ? null : (
					<AppIcon
						size={14}
						name="chevron-right"
						className={clsx(
							"text-text-subtle transition-transform motion-reduce:transition-none",
							open && "rotate-90",
						)}
					/>
				)}
			</button>
			<Collapse open={open}>
				<ol id={listId} className="border-t border-border px-3 py-1.5">
					{props.steps.map((step) => (
						<StepRow step={step} key={step.id} />
					))}
				</ol>
			</Collapse>
		</div>
	);
}

function StepRow(props: { readonly step: AssistantTranscriptStep }) {
	const { step } = props;
	const detail = stepDetail(step);
	const icon = step.kind === "reasoning" ? null : statusIcons[step.status];
	return (
		<li className="grid grid-cols-[1rem_minmax(0,1fr)] items-baseline gap-2 py-1">
			{icon === null ? (
				<AppIcon size={14} name="sparkles" className="text-text-subtle" />
			) : (
				<span className="flex">
					<AppIcon size={14} name={icon.name} className={icon.className} />
					<span className="sr-only">{icon.label}</span>
				</span>
			)}
			<div className="min-w-0">
				<span className="font-medium text-text">{stepTitle(step)}</span>
				{detail === undefined ? null : <span className="text-text-subtle"> · {detail}</span>}
				{step.kind === "reasoning" ? (
					<p className="mt-1 whitespace-pre-wrap text-text-muted">{step.text}</p>
				) : null}
			</div>
		</li>
	);
}
