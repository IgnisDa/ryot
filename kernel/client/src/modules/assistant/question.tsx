import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Button, Checkbox, Notice, Radio, TextField } from "@ryot-app/plugin-ui-sdk";
import type { AssistantTranscriptEntry } from "@ryot-app/ryotql-recipes/assistant";
import { Effect } from "effect";
import { useState } from "react";

import { ASSISTANT_NAME } from "./presentation";
import { answerMutation, assistantFailureText } from "./service";

type QuestionEntry = Extract<AssistantTranscriptEntry, { readonly kind: "question" }>;

const replaced = <A,>(values: readonly A[], index: number, value: A) =>
	values.map((current, position) => (position === index ? value : current));

export function AssistantQuestion(props: {
	readonly disabled: boolean;
	readonly entry: QuestionEntry;
	readonly conversationId: AssistantConversationId;
}) {
	const { entry } = props;
	const answer = useRyotMutation(answerMutation);
	const [chosen, setChosen] = useState<readonly (readonly string[])[]>(() =>
		entry.questions.map(() => []),
	);
	const [written, setWritten] = useState<readonly string[]>(() => entry.questions.map(() => ""));
	if (entry.state !== "pending") {
		return (
			<section
				aria-label={`${ASSISTANT_NAME}'s questions`}
				className="grid gap-2 rounded-lg border border-border-card bg-surface px-3 py-2 text-label"
			>
				{entry.questions.map((question, index) => (
					<div key={question.question} className="grid gap-0.5">
						<span className="text-text-muted">{question.question}</span>
						<span className="font-medium text-text">{entry.answers?.[index] ?? "Not answered"}</span>
					</div>
				))}
			</section>
		);
	}
	const answers = entry.questions.map((_, index) =>
		[...(chosen[index] ?? []), (written[index] ?? "").trim()]
			.filter((value) => value !== "")
			.join(", "),
	);
	return (
		<section
			data-assistant-pending-approval=""
			aria-label={`${ASSISTANT_NAME}'s questions`}
			className="overflow-hidden rounded-xl border border-border-emphasis bg-surface shadow-card"
		>
			<p className="bg-info-soft px-4 py-2 text-label font-medium text-info">
				{ASSISTANT_NAME} needs your input
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
							key={question.question}
							className="grid gap-2"
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
								aria-label={question.question}
								value={written[index] ?? ""}
								onChange={(event) => setWritten(replaced(written, index, event.target.value))}
								placeholder={
									(question.options ?? []).length > 0 ? "Or answer in your own words" : "Your answer"
								}
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
						{answer.isPending ? "Sending…" : "Send answers"}
					</Button>
				</div>
				{answer.error === null ? null : (
					<Notice tone="danger">{assistantFailureText(answer.error)}</Notice>
				)}
			</form>
		</section>
	);
}
