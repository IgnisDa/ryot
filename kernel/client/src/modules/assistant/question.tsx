import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Button, Checkbox, Notice, Radio, TextField } from "@ryot-app/plugin-ui-sdk";
import type { AssistantTranscriptEntry } from "@ryot-app/ryotql-recipes/assistant";
import { Effect } from "effect";
import { useState } from "react";

import { ASSISTANT_NAME } from "./presentation";
import { answerMutation, assistantFailureMessage } from "./service";

type QuestionEntry = Extract<AssistantTranscriptEntry, { readonly kind: "question" }>;

const replaced = <A,>(values: readonly A[], index: number, value: A) =>
	values.map((current, position) => (position === index ? value : current));

export function AssistantQuestion(props: {
	readonly disabled: boolean;
	readonly entry: QuestionEntry;
	readonly conversationId: AssistantConversationId;
}) {
	const { entry } = props;
	const t = useT();
	const formatters = useFormatters();
	const answer = useRyotMutation(answerMutation);
	const [chosen, setChosen] = useState<readonly (readonly string[])[]>(() =>
		entry.questions.map(() => []),
	);
	const [written, setWritten] = useState<readonly string[]>(() => entry.questions.map(() => ""));
	const sectionLabel = t(
		kernelMessage("client.assistant.question.label", { name: ASSISTANT_NAME }),
	);
	if (entry.state !== "pending") {
		return (
			<section
				aria-label={sectionLabel}
				className="grid gap-2 rounded-lg border border-border-card bg-surface px-3 py-2 text-label"
			>
				{entry.questions.map((question, index) => (
					<div key={question.question} className="grid gap-0.5">
						<span className="text-text-muted">{question.question}</span>
						<span className="font-medium text-text">
							{entry.answers?.[index] ?? t(kernelMessage("client.assistant.question.not-answered"))}
						</span>
					</div>
				))}
			</section>
		);
	}
	const answerList = formatters.list({ type: "unit" });
	const answers = entry.questions.map((_, index) =>
		answerList.format(
			[...(chosen[index] ?? []), (written[index] ?? "").trim()].filter((value) => value !== ""),
		),
	);
	return (
		<section
			aria-label={sectionLabel}
			data-assistant-pending-approval=""
			className="overflow-hidden rounded-xl border border-border-emphasis bg-surface shadow-card"
		>
			<p className="bg-info-soft px-4 py-2 text-label font-medium text-info">
				{t(kernelMessage("client.assistant.question.needs-input", { name: ASSISTANT_NAME }))}
			</p>
			<form
				className="grid gap-4 p-4"
				onSubmit={(event) => {
					event.preventDefault();
					void Effect.runPromise(
						answer
							.mutateEffect({
								answers,
								toolCallId: entry.call.id,
								turnId: entry.call.turnId,
								conversationId: props.conversationId,
							})
							.pipe(Effect.ignore),
					);
				}}
			>
				{entry.questions.map((question, index) => {
					const selected = chosen[index] ?? [];
					const Choice = question.multiple === true ? Checkbox : Radio;
					return (
						<fieldset
							className="grid gap-2"
							key={question.question}
							disabled={props.disabled || answer.isPending}
						>
							<legend className="mb-1 font-semibold text-text">{question.question}</legend>
							{(question.options ?? []).map((option) => (
								<Choice
									key={option}
									label={option}
									name={`${entry.id}:${index}`}
									checked={selected.includes(option)}
									onChange={(event) => {
										let next = [option];
										if (question.multiple === true) {
											next = event.target.checked
												? [...selected, option]
												: selected.filter((value) => value !== option);
										}
										setChosen(replaced(chosen, index, next));
									}}
								/>
							))}
							<TextField
								value={written[index] ?? ""}
								aria-label={question.question}
								onChange={(event) => setWritten(replaced(written, index, event.target.value))}
								placeholder={t(
									(question.options ?? []).length > 0
										? kernelMessage("client.assistant.question.own-words")
										: kernelMessage("client.assistant.question.answer-placeholder"),
								)}
							/>
						</fieldset>
					);
				})}
				<div className="flex justify-end">
					<Button
						size="sm"
						type="submit"
						disabled={answers.includes("") || props.disabled || answer.isPending}
					>
						{t(
							answer.isPending
								? kernelMessage("client.assistant.question.sending")
								: kernelMessage("client.assistant.question.send"),
						)}
					</Button>
				</div>
				{answer.error === null ? null : (
					<Notice tone="danger">{t(assistantFailureMessage(answer.error))}</Notice>
				)}
			</form>
		</section>
	);
}
