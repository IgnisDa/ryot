import type { AssistantApprovalDecision } from "@ryot-app/contract/modules/assistant/schemas";
import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Card, Field, LoadMoreButton, Notice, TextArea } from "@ryot-app/plugin-ui-sdk";
import type { AssistantConversationDetail } from "@ryot-app/ryotql-recipes/assistant";
import { Effect } from "effect";
import { useEffect, useState } from "react";

import { AssistantCallArguments } from "./call-arguments";
import { AssistantPagePreview } from "./preview";
import {
	assistantFailureText,
	callsQuery,
	conversationQuery,
	conversationsQuery,
	createConversationMutation,
	decideMutation,
	deleteConversationMutation,
	messagesQuery,
	providerQuery,
	submitMutation,
	turnsQuery,
} from "./service";

const initialCursor: string | undefined = undefined;
const paging = {
	initialPageParam: initialCursor,
	getNextPageParam: nextPageCursor,
	getPageInput: (input: { readonly conversationId: string }, after: string | undefined) => ({
		...input,
		after,
	}),
};

export function AssistantApprovalCard(props: {
	readonly disabled: boolean;
	readonly turnActive: boolean;
	readonly conversationId: AssistantConversationId;
	readonly call: AssistantConversationDetail["calls"]["items"][number];
}) {
	const decide = useRyotMutation(decideMutation);
	const { call } = props;
	const pending =
		call.call.requiresApproval &&
		call.decision === null &&
		call.result === null &&
		props.turnActive;
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
	let status = "Waiting for Ryobot";
	if (call.decision === "approve") {
		status = "Approved";
	}
	if (call.result !== null) {
		status = "Finished";
	}
	if (call.decision === "decline") {
		status = "Declined";
	}

	return (
		<Card className="grid gap-3">
			<p className="font-medium">{call.call.descriptor.name}</p>
			<p>{call.call.descriptor.description}</p>
			<AssistantCallArguments arguments={call.call.arguments} key={`${call.id}:${call.revision}`} />
			{pending ? (
				<>
					<p>
						{call.call.descriptor.hints.destructive
							? "This action may permanently change or remove data."
							: "Ryobot needs your approval to make this change."}
					</p>
					<div className="flex gap-2">
						<Button onClick={() => send("approve")} disabled={props.disabled || decide.isPending}>
							Approve
						</Button>
						<Button
							variant="secondary"
							onClick={() => send("decline")}
							disabled={props.disabled || decide.isPending}
						>
							Decline
						</Button>
					</div>
				</>
			) : (
				<p className="text-sm text-text-muted">{status}</p>
			)}
			{decide.error === null ? null : (
				<Notice tone="danger">{assistantFailureText(decide.error)}</Notice>
			)}
		</Card>
	);
}

export function AssistantConversations(props: {
	readonly disabled: boolean;
	readonly selected: null | AssistantConversationId;
	readonly onSelect: (id: null | AssistantConversationId) => void;
}) {
	const provider = useRyotQuery(providerQuery, {});
	const create = useRyotMutation(createConversationMutation);
	const conversations = useRyotInfiniteQuery(
		conversationsQuery,
		{},
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (_input, after: string | undefined) => ({ after }),
		},
	);
	const items = paginationItems(
		conversations.pages,
		(page) => page.items,
		(item) => item.id,
	);
	return (
		<div className="grid gap-5">
			{provider.isError ? (
				<Notice tone="danger" action={<Button onClick={provider.refetch}>Retry</Button>}>
					Provider settings could not be loaded.
				</Notice>
			) : null}
			{!provider.isError && provider.data === null ? (
				<Notice tone="info">
					Connect your provider in <a href="/settings/assistant">Settings → Ryobot</a> to start
					chatting.
				</Notice>
			) : null}
			{props.disabled ? (
				<Notice tone="info">
					Demo sessions can chat, but cannot approve changes, save pages or configure providers.
				</Notice>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={create.isPending || provider.data == null}
					onClick={() =>
						void Effect.runPromise(
							create
								.mutateEffect({ title: "New conversation" })
								.pipe(
									Effect.match({
										onFailure: () => undefined,
										onSuccess: (result) => props.onSelect(result.conversationId),
									}),
								),
						)
					}
				>
					New conversation
				</Button>
				{props.selected !== null ? (
					<Button variant="ghost" onClick={() => props.onSelect(null)}>
						All conversations
					</Button>
				) : null}
			</div>
			{create.error === null ? null : (
				<Notice tone="danger">{assistantFailureText(create.error)}</Notice>
			)}
			{props.selected === null ? (
				<>
					{conversations.isError ? (
						<Notice tone="danger" action={<Button onClick={conversations.refetch}>Retry</Button>}>
							Conversations could not be loaded.
						</Notice>
					) : null}
					{items.length === 0 && !conversations.isPending && !conversations.isError ? (
						<p>Start a conversation to explore your data or ask Ryobot to build a page.</p>
					) : null}
					{items.map((item) => (
						<Card key={item.id}>
							<button className="w-full text-left" onClick={() => props.onSelect(item.id)}>
								{item.title}
							</button>
						</Card>
					))}
					{conversations.hasNextPage ? (
						<LoadMoreButton
							label="Load more conversations"
							onClick={conversations.fetchNextPage}
							isFetchingNextPage={conversations.isFetchingNextPage}
						/>
					) : null}
				</>
			) : (
				<AssistantConversation
					key={props.selected}
					disabled={props.disabled}
					conversationId={props.selected}
					providerReady={provider.data != null}
					onDeleted={() => props.onSelect(null)}
				/>
			)}
		</div>
	);
}

function turnFailureText(turn: AssistantConversationDetail["turns"]["items"][number]) {
	if (turn.failure?.code === "provider-unavailable") {
		return "Your provider is unavailable. Check Settings → Ryobot.";
	}
	if (turn.status === "interrupted") {
		return "This reply was interrupted. You can send another message.";
	}
	return "Ryobot could not finish this reply. You can try again.";
}

function AssistantConversation(props: {
	readonly disabled: boolean;
	readonly onDeleted: () => void;
	readonly providerReady: boolean;
	readonly conversationId: AssistantConversationId;
}) {
	const input = { conversationId: props.conversationId };
	const detail = useRyotQuery(conversationQuery, { arguments: input });
	const messages = useRyotInfiniteQuery(messagesQuery, input, paging);
	const calls = useRyotInfiniteQuery(callsQuery, input, paging);
	const turns = useRyotInfiniteQuery(turnsQuery, input, paging);
	const submit = useRyotMutation(submitMutation);
	const remove = useRyotMutation(deleteConversationMutation);
	const [text, setText] = useState("");
	const [submission, setSubmission] = useState<null | {
		readonly text: string;
		readonly requestId: string;
	}>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	useEffect(() => {
		if (calls.hasNextPage && !calls.isFetching && !calls.isError) {
			calls.fetchNextPage();
		}
	}, [calls]);
	useEffect(() => {
		if (turns.hasNextPage && !turns.isFetching && !turns.isError) {
			turns.fetchNextPage();
		}
	}, [turns]);
	useEffect(() => {
		if (messages.hasNextPage && !messages.isFetching && !messages.isError) {
			messages.fetchNextPage();
		}
	}, [messages]);
	const messageItems = paginationItems(
		messages.pages,
		(page) => page.items,
		(item) => item.id,
	);
	const callItems = paginationItems(
		calls.pages,
		(page) => page.items,
		(item) => item.id,
	);
	const turnItems = paginationItems(
		turns.pages,
		(page) => page.items,
		(item) => item.id,
	);
	const complete =
		!calls.isPending &&
		!turns.isPending &&
		!calls.hasNextPage &&
		!turns.hasNextPage &&
		!calls.isError &&
		!turns.isError;
	const active = turnItems.some(
		(turn) =>
			turn.status === "queued" || turn.status === "running" || turn.status === "awaiting-approval",
	);
	const errors = [detail, messages, calls, turns].filter((query) => query.isError);
	const sendLabel = submission !== null ? "Retry message" : "Send";

	return (
		<section className="grid gap-4" aria-label="Conversation">
			<h2 className="text-lg font-medium">{detail.data?.conversation?.title ?? "Conversation"}</h2>
			{errors.length > 0 ? (
				<Notice
					tone="danger"
					action={
						<Button
							onClick={() => {
								detail.refetch();
								messages.refetch();
								calls.refetch();
								turns.refetch();
							}}
						>
							Retry
						</Button>
					}
				>
					The conversation could not be fully loaded. Review requests after refreshing.
				</Notice>
			) : null}
			{messageItems.map((message) => (
				<Card key={message.id} className="grid gap-3">
					<p className="text-sm font-medium">{message.role === "user" ? "You" : "Ryobot"}</p>
					<p className="whitespace-pre-wrap">
						{message.parts
							.flatMap((part) => (part.kind === "text" ? [part.text] : []))
							.join("\n\n")}
					</p>
					{message.parts
						.filter((part) => part.kind === "page-preview")
						.map((part) => (
							<AssistantPagePreview
								turnId={message.turnId}
								disabled={props.disabled}
								conversationId={props.conversationId}
								key={`${part.pageId}:${part.draftRevision}:${part.definitionHash}:${part.artifactHash}`}
								identity={{
									pageId: part.pageId,
									artifactHash: part.artifactHash,
									draftRevision: part.draftRevision,
									definitionHash: part.definitionHash,
								}}
							/>
						))}
				</Card>
			))}
			{messages.hasNextPage ? (
				<LoadMoreButton
					label="Load more messages"
					onClick={messages.fetchNextPage}
					isFetchingNextPage={messages.isFetchingNextPage}
				/>
			) : null}
			{!complete && errors.length === 0 ? <p role="status">Loading review requests…</p> : null}
			{callItems.map((call) => (
				<AssistantApprovalCard
					call={call}
					key={call.id}
					conversationId={props.conversationId}
					disabled={props.disabled || !complete || calls.isRefreshing || turns.isRefreshing}
					turnActive={turnItems.some(
						(turn) => turn.id === call.turnId && turn.status === "awaiting-approval",
					)}
				/>
			))}
			{turnItems.some((turn) => turn.status === "queued" || turn.status === "running") ? (
				<p role="status" aria-live="polite">
					Ryobot is working…
				</p>
			) : null}
			{turnItems
				.filter((turn) => turn.status === "failed" || turn.status === "interrupted")
				.map((turn) => (
					<Notice key={turn.id} tone="danger">
						{turnFailureText(turn)}
					</Notice>
				))}
			<form
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					const captured = submission ?? { text: text.trim(), requestId: crypto.randomUUID() };
					setSubmission(captured);
					void Effect.runPromise(
						submit.mutateEffect({ ...captured, conversationId: props.conversationId }).pipe(
							Effect.match({
								onFailure: () => undefined,
								onSuccess: () => {
									setText("");
									setSubmission(null);
								},
							}),
						),
					);
				}}
			>
				<Field label="Message Ryobot">
					{(control) => (
						<TextArea
							{...control}
							required
							rows={3}
							value={text}
							disabled={submission !== null}
							onChange={(event) => setText(event.target.value)}
						/>
					)}
				</Field>
				<Button
					type="submit"
					disabled={
						!props.providerReady || !complete || active || submit.isPending || text.trim() === ""
					}
				>
					{submit.isPending ? "Sending…" : sendLabel}
				</Button>
			</form>
			{submit.error === null ? null : (
				<Notice tone="danger">{assistantFailureText(submit.error)}</Notice>
			)}
			{confirmDelete ? (
				<div className="flex flex-wrap gap-2">
					<p>Delete this conversation permanently?</p>
					<Button
						variant="dangerGhost"
						disabled={remove.isPending}
						onClick={() =>
							void Effect.runPromise(
								remove
									.mutateEffect({ conversationId: props.conversationId })
									.pipe(Effect.match({ onFailure: () => undefined, onSuccess: props.onDeleted })),
							)
						}
					>
						Delete permanently
					</Button>
					<Button variant="ghost" onClick={() => setConfirmDelete(false)}>
						Cancel
					</Button>
				</div>
			) : (
				<Button variant="ghost" onClick={() => setConfirmDelete(true)}>
					Delete conversation
				</Button>
			)}
			{remove.error === null ? null : (
				<Notice tone="danger">{assistantFailureText(remove.error)}</Notice>
			)}
		</section>
	);
}
