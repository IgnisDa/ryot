import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import { Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { MarkdownDocument } from "@ryot-app/plugin-ui-sdk/markdown";
import {
	type AssistantTranscriptEntry,
	type AssistantTranscriptTurn,
	isActiveAssistantTurn,
} from "@ryot-app/ryotql-recipes/assistant";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";
import { Effect } from "effect";

import { AssistantApproval } from "./approval";
import { AssistantPageDraft } from "./page-draft";
import { ASSISTANT_NAME, stepTitle, turnFailureMessage, workedFor } from "./presentation";
import { AssistantQuestion } from "./question";
import { AssistantSprite } from "./sprite";
import { AssistantSteps } from "./steps";
import { AssistantTodo } from "./todo";

const userBubble =
	"max-w-[85%] justify-self-end rounded-xl rounded-br-sm bg-surface-2 px-3.5 py-2 text-body whitespace-pre-wrap text-text";

export function AssistantTurn(props: {
	readonly disabled: boolean;
	readonly catalog: PluginClientCatalog;
	readonly turn: AssistantTranscriptTurn;
	readonly conversationId: AssistantConversationId;
}) {
	const t = useT();
	const client = useRyot();
	const { turn } = props;
	const active = isActiveAssistantTurn(turn.status);
	const groups = turn.entries.filter((entry) => entry.kind === "steps").length;
	const worked = workedFor(turn);
	const last = turn.entries.at(-1);
	const working = active && turn.status !== "awaiting-approval" && turn.status !== "awaiting-input";
	const entry = (item: AssistantTranscriptEntry) => {
		if (item.kind === "reply") {
			return (
				<div key={item.id} className="text-body leading-relaxed text-text">
					<MarkdownDocument
						text={item.text}
						onOpenLink={(url) =>
							void Effect.runPromise(client.links.open({ url }).pipe(Effect.ignore))
						}
					/>
				</div>
			);
		}
		if (item.kind === "steps") {
			const live = working && item === last;
			const current = item.steps.at(-1);
			const count = kernelMessage("client.assistant.turn.steps", { count: item.steps.length });
			let summary: Message = count;
			if (live && current !== undefined) {
				summary = stepTitle(current);
			} else if (groups === 1 && worked !== null) {
				summary = kernelMessage("client.assistant.turn.worked-summary", {
					steps: count,
					duration: worked,
				});
			}
			return <AssistantSteps live={live} key={item.id} steps={item.steps} summary={t(summary)} />;
		}
		if (item.kind === "compaction") {
			return (
				<p key={item.id} role="separator" className="text-center text-label text-text-subtle">
					{t(kernelMessage("client.assistant.turn.compaction"))}
				</p>
			);
		}
		if (item.kind === "steer") {
			return (
				<p key={item.id} className={userBubble}>
					{item.text}
				</p>
			);
		}
		if (item.kind === "todo") {
			return <AssistantTodo key={item.id} items={item.items} />;
		}
		if (item.kind === "question") {
			return (
				<AssistantQuestion
					entry={item}
					key={item.id}
					disabled={props.disabled}
					conversationId={props.conversationId}
				/>
			);
		}
		if (item.kind === "approval") {
			return (
				<AssistantApproval
					key={item.id}
					call={item.call}
					state={item.state}
					catalog={props.catalog}
					disabled={props.disabled}
					conversationId={props.conversationId}
				/>
			);
		}
		return (
			<AssistantPageDraft
				key={item.id}
				turnId={turn.id}
				identity={item.identity}
				disabled={props.disabled}
				conversationId={props.conversationId}
			/>
		);
	};
	return (
		<article
			className="grid gap-3"
			aria-label={t(kernelMessage("client.assistant.turn.label", { name: ASSISTANT_NAME }))}
		>
			<p className={userBubble}>{turn.prompt}</p>
			{turn.entries.map(entry)}
			{turn.queued.map(({ id, text }) => (
				<div key={id} className="grid justify-items-end gap-1">
					<p className={clsx(userBubble, "opacity-60")}>{text}</p>
					<span className="text-micro text-text-subtle">
						{t(kernelMessage("client.assistant.turn.queued", { name: ASSISTANT_NAME }))}
					</span>
				</div>
			))}
			{working && last?.kind !== "steps" ? (
				<p role="status" className="flex items-center gap-2 text-label text-text-muted">
					<AssistantSprite mood="thinking" className="w-6" />
					{t(kernelMessage("client.assistant.turn.working", { name: ASSISTANT_NAME }))}
				</p>
			) : null}
			{turn.partial ? (
				<p className="text-label text-text-subtle">
					{t(kernelMessage("client.assistant.turn.partial"))}
				</p>
			) : null}
			{turn.status === "failed" ? (
				<Notice tone="danger">{t(turnFailureMessage(turn.failure))}</Notice>
			) : null}
			{turn.status === "interrupted" ? (
				<p className="flex items-center gap-2 text-label text-text-subtle">
					<AppIcon size={12} name="square" />
					{t(kernelMessage("client.assistant.turn.stopped"))}
				</p>
			) : null}
		</article>
	);
}
