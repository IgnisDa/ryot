import { AssistantConversationTitle } from "@ryot-app/contract/modules/assistant/schemas";
import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	DestructiveConfirmation,
	Dialog,
	EmptyState,
	Field,
	LoadMoreButton,
	MenuButton,
	Notice,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	type AssistantTranscriptTurn,
	isActiveAssistantTurn,
	projectAssistantTurn,
} from "@ryot-app/ryotql-recipes/assistant";
import { useNavigate } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { useMemo, useRef, useState } from "react";

import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { AppScreen } from "#/modules/shell/app-screen";

import { AssistantComposer, useAssistantSubmit } from "./composer";
import {
	assistantFailureText,
	deleteConversationMutation,
	interruptMutation,
	providerQuery,
	renameConversationMutation,
	transcriptQuery,
} from "./service";
import { AssistantTurn } from "./turn";

const initialCursor: string | undefined = undefined;
const isTitle = Schema.is(AssistantConversationTitle);

export function AssistantThread(props: {
	readonly disabled: boolean;
	readonly conversationId: AssistantConversationId;
}) {
	const navigate = useNavigate();
	const { catalog } = usePluginCatalog();
	const provider = useRyotQuery(providerQuery, {});
	const transcript = useRyotInfiniteQuery(
		transcriptQuery,
		{ conversationId: props.conversationId },
		{
			initialPageParam: initialCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after }),
			getNextPageParam: (page, param, pages) =>
				nextPageCursor(
					page.turns,
					param,
					pages.map((item) => item.turns),
				),
		},
	);
	const interrupt = useRyotMutation(interruptMutation);
	const remove = useRyotMutation(deleteConversationMutation);
	const submit = useAssistantSubmit({ conversationId: props.conversationId });
	const [renaming, setRenaming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const conversation = transcript.pages[0]?.conversation;
	const { turns, latest } = useMemo((): {
		readonly turns: readonly AssistantTranscriptTurn[];
		readonly latest: undefined | AssistantTranscriptTurn;
	} => {
		const newestFirst = paginationItems(
			transcript.pages,
			(page) => page.turns.items,
			(turn) => turn.id,
		);
		const ordered: AssistantTranscriptTurn[] = [];
		for (let index = newestFirst.length - 1; index >= 0; index -= 1) {
			ordered.push(projectAssistantTurn(newestFirst[index]));
		}
		return { turns: ordered, latest: ordered[ordered.length - 1] };
	}, [transcript.pages]);
	const active = latest !== undefined && isActiveAssistantTurn(latest.status);

	if (transcript.isSuccess && conversation === undefined) {
		return (
			<AppScreen title="Conversation" backFallbackHref="/assistant">
				<EmptyState
					description="It may have been deleted."
					title="This conversation is no longer available"
					action={<Button onClick={() => void navigate({ to: "/assistant/new" })}>New chat</Button>}
				/>
			</AppScreen>
		);
	}

	const title = conversation?.title ?? "Conversation";
	let dock = (
		<AssistantComposer
			submit={submit}
			placeholder="Reply to Ryobot"
			disabled={provider.data == null}
			stop={
				active
					? {
							pending: interrupt.isPending,
							onStop: () =>
								void Effect.runPromise(
									interrupt
										.mutateEffect({ turnId: latest.id, conversationId: props.conversationId })
										.pipe(Effect.ignore),
								),
						}
					: undefined
			}
		/>
	);
	if (latest?.status === "awaiting-approval") {
		dock = (
			<div className="mx-auto flex w-full max-w-2xl items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-3 text-label text-text-muted">
				<span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />
				<span className="flex-1">Ryobot is waiting for your decision.</span>
				<Button
					size="sm"
					variant="secondary"
					onClick={() =>
						document
							.querySelector("[data-assistant-pending-approval]")
							?.scrollIntoView({ block: "center", behavior: "smooth" })
					}
				>
					Review
				</Button>
			</div>
		);
	}

	return (
		<AppScreen
			dock={dock}
			title={title}
			width="readable"
			followEnd={latest?.id ?? ""}
			backFallbackHref="/assistant"
			actions={
				<MenuButton
					label="Conversation actions"
					icon={<AppIcon size={16} name="more-horizontal" />}
					items={[
						{ key: "rename", label: "Rename", onSelect: () => setRenaming(true) },
						{
							key: "delete",
							label: "Delete",
							disabled: active,
							destructive: true,
							onSelect: () => setDeleting(true),
						},
					]}
				/>
			}
		>
			<div className="grid gap-6 pb-2">
				{props.disabled ? (
					<Notice tone="info">
						Demo sessions can chat, but cannot approve changes or save pages.
					</Notice>
				) : null}
				{provider.data === null ? (
					<Notice tone="info">
						Connect your provider in <a href="/settings/assistant">Settings → Ryobot</a> to keep
						chatting.
					</Notice>
				) : null}
				{transcript.isError ? (
					<Notice tone="danger" action={<Button onClick={transcript.refetch}>Retry</Button>}>
						The conversation could not be loaded.
					</Notice>
				) : null}
				{transcript.hasNextPage ? (
					<LoadMoreButton
						label="Show earlier messages"
						onClick={transcript.fetchNextPage}
						isFetchingNextPage={transcript.isFetchingNextPage}
					/>
				) : null}
				{transcript.isPending ? (
					<p role="status" className="text-sm text-text-muted">
						Loading conversation…
					</p>
				) : null}
				{turns.map((turn) => (
					<AssistantTurn
						turn={turn}
						key={turn.id}
						catalog={catalog}
						disabled={props.disabled}
						conversationId={props.conversationId}
					/>
				))}
				{interrupt.error === null ? null : (
					<Notice tone="danger">{assistantFailureText(interrupt.error)}</Notice>
				)}
			</div>
			{renaming ? (
				<RenameDialog
					title={title}
					onClose={() => setRenaming(false)}
					conversationId={props.conversationId}
				/>
			) : null}
			{deleting ? (
				<DestructiveConfirmation
					triggerRef={menuTrigger}
					pendingLabel="Deleting…"
					pending={remove.isPending}
					title="Delete this conversation?"
					actionLabel="Delete conversation"
					onClose={() => setDeleting(false)}
					detail="Its messages and history are removed permanently. Saved pages stay."
					errorMessage={remove.error === null ? undefined : assistantFailureText(remove.error)}
					onConfirm={() =>
						void Effect.runPromise(
							remove
								.mutateEffect({ conversationId: props.conversationId })
								.pipe(
									Effect.match({
										onFailure: () => undefined,
										onSuccess: () => void navigate({ to: "/assistant" }),
									}),
								),
						)
					}
				/>
			) : null}
		</AppScreen>
	);
}

function RenameDialog(props: {
	readonly title: string;
	readonly onClose: () => void;
	readonly conversationId: AssistantConversationId;
}) {
	const rename = useRyotMutation(renameConversationMutation);
	const [title, setTitle] = useState(props.title);
	const formId = "assistant-rename";
	return (
		<Dialog
			size="sm"
			closeLabel="Cancel"
			onClose={props.onClose}
			title="Rename conversation"
			footer={
				<Button type="submit" form={formId} disabled={rename.isPending || !isTitle(title.trim())}>
					{rename.isPending ? "Saving…" : "Save"}
				</Button>
			}
		>
			<form
				id={formId}
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					void Effect.runPromise(
						rename
							.mutateEffect({ title: title.trim(), conversationId: props.conversationId })
							.pipe(Effect.match({ onSuccess: props.onClose, onFailure: () => undefined })),
					);
				}}
			>
				<Field label="Title">
					{(control) => (
						<TextField
							{...control}
							required
							value={title}
							maxLength={60}
							onChange={(event) => setTitle(event.target.value)}
						/>
					)}
				</Field>
				{rename.error === null ? null : (
					<Notice tone="danger">{assistantFailureText(rename.error)}</Notice>
				)}
			</form>
		</Dialog>
	);
}
