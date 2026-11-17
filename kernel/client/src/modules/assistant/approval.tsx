import type { AssistantApprovalDecision } from "@ryot-app/contract/modules/assistant/schemas";
import { AgentToolName } from "@ryot-app/contract/schema/agent-tool";
import { approvalSubject, type ApprovalTarget } from "@ryot-app/contract/schema/approval";
import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, JsonSchemaValues, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type {
	AssistantApprovalState,
	AssistantCallRecord,
} from "@ryot-app/ryotql-recipes/assistant";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect, Schema } from "effect";
import { useState } from "react";

import { ASSISTANT_NAME, catalogSourceName } from "./presentation";
import { assistantFailureMessage, decideMutation } from "./service";

const settled = {
	declined: {
		icon: "x",
		tone: "text-danger",
		label: kernelMessage("client.assistant.approval.declined"),
	},
	approved: {
		icon: "check",
		tone: "text-success",
		label: kernelMessage("client.assistant.approval.approved"),
	},
	expired: {
		icon: "square",
		tone: "text-text-subtle",
		label: kernelMessage("client.assistant.approval.not-decided"),
	},
} as const;

export function AssistantApproval(props: {
	readonly disabled: boolean;
	readonly call: AssistantCallRecord;
	readonly catalog: PluginClientCatalog;
	readonly state: AssistantApprovalState;
	readonly conversationId: AssistantConversationId;
}) {
	const t = useT();
	const decide = useRyotMutation(decideMutation);
	const [raw, setRaw] = useState(false);
	const { call } = props;
	const target = call.call;
	let approvalTarget: null | ApprovalTarget = null;
	if (target.kind === "capability") {
		approvalTarget = target;
	} else if (Schema.is(AgentToolName)(target.tool)) {
		approvalTarget = { kind: "tool", tool: target.tool };
	}
	if (approvalTarget === null) {
		return null;
	}
	const subject = approvalSubject(approvalTarget, catalogSourceName(props.catalog, t));
	if (props.state !== "pending") {
		const outcome = settled[props.state];
		return (
			<div className="flex items-center gap-2 rounded-lg border border-border-card bg-surface px-3 py-2 text-label text-text-muted">
				<AppIcon size={14} name={outcome.icon} className={outcome.tone} />
				<span>{t(outcome.label)}</span>
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
			className="overflow-hidden rounded-xl border border-border-emphasis bg-surface shadow-card"
			aria-label={t(
				kernelMessage("client.assistant.approval.review-label", { title: subject.title }),
			)}
		>
			<p className="bg-warning-soft px-4 py-2 text-label font-medium text-warning">
				{t(kernelMessage("client.assistant.approval.wants-change", { name: ASSISTANT_NAME }))}
			</p>
			<div className="grid gap-3 p-4">
				<div className="grid gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-semibold text-text">{subject.title}</h3>
						<Badge size="sm" variant={subject.destructive ? "danger" : "info"}>
							{t(
								subject.destructive
									? kernelMessage("client.assistant.approval.may-remove-data")
									: kernelMessage("client.assistant.approval.changes-data"),
							)}
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
						aria-label={t(kernelMessage("client.assistant.approval.raw-input"))}
						className="max-h-72 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-micro text-text-muted"
					>
						{JSON.stringify(call.call.arguments, null, 2)}
					</pre>
				) : null}
				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm" variant="ghost" aria-expanded={raw} onClick={() => setRaw(!raw)}>
						{t(
							raw
								? kernelMessage("client.assistant.approval.hide-raw")
								: kernelMessage("client.assistant.approval.show-raw"),
						)}
					</Button>
					<span className="flex-1" />
					<Button
						size="sm"
						variant="secondary"
						onClick={() => send("decline")}
						disabled={props.disabled || decide.isPending}
					>
						{t(kernelMessage("client.assistant.approval.decline"))}
					</Button>
					<Button
						size="sm"
						onClick={() => send("approve")}
						disabled={props.disabled || decide.isPending}
					>
						{t(kernelMessage("client.assistant.approval.approve"))}
					</Button>
				</div>
				{decide.error === null ? null : (
					<Notice tone="danger">{t(assistantFailureMessage(decide.error))}</Notice>
				)}
			</div>
		</section>
	);
}
