import type { AssistantApprovalDecision } from "@ryot-app/contract/modules/assistant/schemas";
import { approvalSubject } from "@ryot-app/contract/schema/approval";
import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, JsonSchemaValues, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type {
	AssistantApprovalState,
	AssistantCallRecord,
} from "@ryot-app/ryotql-recipes/assistant";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect } from "effect";
import { useState } from "react";

import { ASSISTANT_NAME, catalogSourceName } from "./presentation";
import { assistantFailureText, decideMutation } from "./service";

const settled = {
	declined: { icon: "x", label: "Declined", tone: "text-danger" },
	approved: { icon: "check", label: "Approved", tone: "text-success" },
	expired: { icon: "square", label: "Not decided", tone: "text-text-subtle" },
} as const;

export function AssistantApproval(props: {
	readonly disabled: boolean;
	readonly call: AssistantCallRecord;
	readonly catalog: PluginClientCatalog;
	readonly state: AssistantApprovalState;
	readonly conversationId: AssistantConversationId;
}) {
	const decide = useRyotMutation(decideMutation);
	const [raw, setRaw] = useState(false);
	const { call } = props;
	const subject = approvalSubject(call.call, catalogSourceName(props.catalog));
	if (props.state !== "pending") {
		const outcome = settled[props.state];
		return (
			<div className="flex items-center gap-2 rounded-lg border border-border-card bg-surface px-3 py-2 text-label text-text-muted">
				<AppIcon size={14} name={outcome.icon} className={outcome.tone} />
				<span>{outcome.label}</span>
				<span aria-hidden="true">·</span>
				<span className="min-w-0 truncate font-medium text-text">{subject.title}</span>
			</div>
		);
	}
	const send = (decision: AssistantApprovalDecision) =>
		void Effect.runPromise(
			decide
				.mutateEffect({
					decision,
					turnId: call.turnId,
					toolCallId: call.id,
					expectedRevision: call.revision,
					conversationId: props.conversationId,
				})
				.pipe(Effect.ignore),
		);
	return (
		<section
			data-assistant-pending-approval=""
			aria-label={`Approve ${subject.title}`}
			className="overflow-hidden rounded-xl border border-border-emphasis bg-surface shadow-card"
		>
			<p className="bg-warning-soft px-4 py-2 text-label font-medium text-warning">
				{ASSISTANT_NAME} wants to make a change
			</p>
			<div className="grid gap-3 p-4">
				<div className="grid gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-semibold text-text">{subject.title}</h3>
						<Badge size="sm" variant={subject.destructive ? "danger" : "info"}>
							{subject.destructive ? "May remove data" : "Changes data"}
						</Badge>
					</div>
					<p className="text-label text-text-subtle">
						{subject.source} · {subject.description}
					</p>
				</div>
				<div className="rounded-md bg-bg p-3">
					<JsonSchemaValues schema={subject.schema} value={call.call.arguments} />
				</div>
				{raw ? (
					<pre
						aria-label="Raw input"
						className="max-h-72 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-micro text-text-muted"
					>
						{JSON.stringify(call.call.arguments, null, 2)}
					</pre>
				) : null}
				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm" variant="ghost" aria-expanded={raw} onClick={() => setRaw(!raw)}>
						{raw ? "Hide raw input" : "Show raw input"}
					</Button>
					<span className="flex-1" />
					<Button
						size="sm"
						variant="secondary"
						onClick={() => send("decline")}
						disabled={props.disabled || decide.isPending}
					>
						Decline
					</Button>
					<Button
						size="sm"
						onClick={() => send("approve")}
						disabled={props.disabled || decide.isPending}
					>
						Approve
					</Button>
				</div>
				{decide.error === null ? null : (
					<Notice tone="danger">{assistantFailureText(decide.error)}</Notice>
				)}
			</div>
		</section>
	);
}
