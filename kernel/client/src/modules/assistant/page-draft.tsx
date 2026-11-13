import type {
	SaveAssistantPageBody,
	SaveAssistantPageResult,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import type { AssistantConversationId, AssistantTurnId } from "@ryot-app/contract/schema/brands";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, Dialog, Notice, tabId, Tabs } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { useId, useRef, useState } from "react";

import { PageIdentityFields, usePageIdentity } from "#/modules/page-authoring/identity-fields";
import { pageQuery } from "#/modules/page-authoring/service";
import { EmbeddedPagePreview } from "#/modules/pages/runtime/embedded-preview";
import { PublicationPageEditor } from "#/modules/publications/manager";
import { useEdge } from "#/modules/shell/authenticated-shell-context";

import { assistantFailureText, savePageMutation } from "./service";

type DraftProps = {
	readonly disabled: boolean;
	readonly turnId: AssistantTurnId;
	readonly identity: PageDraftBuildIdentity;
	readonly conversationId: AssistantConversationId;
};

const decodeSource = (content: string) => {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Uint8Array.from(atob(content), (character) => character.charCodeAt(0)),
		);
	} catch {
		return null;
	}
};

export function AssistantPageSave(
	props: DraftProps & { readonly name: string; readonly onNavigate: (href: string) => void },
) {
	const save = useRyotMutation(savePageMutation);
	const identity = usePageIdentity(props.name);
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [submission, setSubmission] = useState<null | SaveAssistantPageBody>(null);
	const [saved, setSaved] = useState<null | SaveAssistantPageResult>(null);
	const [sharing, setSharing] = useState(false);
	if (saved !== null) {
		return sharing ? (
			<PublicationPageEditor
				publication={null}
				pageId={saved.pageId}
				disabled={props.disabled}
				onDone={() => setSharing(false)}
				onCreated={(publicationId) =>
					props.onNavigate(
						`/settings/publications#publication-${encodeURIComponent(publicationId)}`,
					)
				}
			/>
		) : (
			<div className="flex flex-wrap items-center gap-2">
				<AppIcon size={16} name="circle-check" className="text-success" />
				<p className="flex-1 text-sm text-text">Saved to your saved views.</p>
				<Button variant="secondary" disabled={props.disabled} onClick={() => setSharing(true)}>
					Share
				</Button>
				<Button onClick={() => props.onNavigate(`/v/c/${encodeURIComponent(saved.savedViewId)}`)}>
					Open page
				</Button>
			</div>
		);
	}
	return (
		<form
			className="grid gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				const captured = submission ?? {
					...props.identity,
					requestId,
					icon: "file-text",
					name: identity.name,
					slug: identity.slug,
					turnId: props.turnId,
					conversationId: props.conversationId,
				};
				setSubmission(captured);
				void Effect.runPromise(
					save
						.mutateEffect(captured)
						.pipe(Effect.match({ onSuccess: setSaved, onFailure: () => undefined })),
				);
			}}
		>
			<PageIdentityFields identity={identity} disabled={submission !== null} />
			<div className="flex flex-wrap items-center gap-2">
				<p className="flex-1 text-label text-text-subtle">
					Saved pages start without write access.
				</p>
				{save.error === null ? null : (
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							setSubmission(null);
							setRequestId(crypto.randomUUID());
							save.reset();
						}}
					>
						Edit details
					</Button>
				)}
				<Button type="submit" disabled={props.disabled || save.isPending || !identity.complete}>
					{save.isPending ? "Saving…" : "Save page"}
				</Button>
			</div>
			{save.error === null ? null : (
				<Notice tone="danger">{assistantFailureText(save.error)}</Notice>
			)}
		</form>
	);
}

function DraftSource(props: { readonly pageId: string }) {
	const page = useRyotQuery(pageQuery, { reload: 0, pageId: props.pageId });
	if (page.data == null) {
		return (
			<p role="status" className="text-sm text-text-muted">
				{page.isError ? "The page source is unavailable." : "Loading source…"}
			</p>
		);
	}
	return (
		<div className="grid gap-4">
			{page.data.draftDefinition.files.map((file) => (
				<section key={file.path} className="grid gap-1.5">
					<h3 className="font-mono text-label text-text-muted">{file.path}</h3>
					<pre className="max-h-96 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-micro text-text">
						{decodeSource(file.content) ?? "Binary file"}
					</pre>
				</section>
			))}
		</div>
	);
}

const tabs = [
	{ value: "preview", label: "Preview" },
	{ value: "source", label: "Source" },
] as const;

export function AssistantPageDraft(props: DraftProps) {
	const edge = useEdge();
	const navigate = useNavigate();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const page = useRyotQuery(pageQuery, { reload: 0, pageId: props.identity.pageId });
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<(typeof tabs)[number]["value"]>("preview");
	const panelId = useId();
	const name = page.data?.name ?? "Page draft";
	const files = page.data?.draftDefinition.files.length;
	return (
		<>
			<div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-card bg-surface p-3">
				<span className="flex size-10 items-center justify-center rounded-md bg-accent-soft text-accent-text">
					<AppIcon size={18} name="file-text" />
				</span>
				<div className="grid min-w-0 flex-1 gap-0.5">
					<p className="truncate font-medium text-text">{name}</p>
					<p className="flex flex-wrap items-center gap-1.5 text-label text-text-subtle">
						<Badge size="sm" variant="neutral">
							Draft
						</Badge>
						Revision {props.identity.draftRevision}
						{files === undefined ? null : ` · ${files} ${files === 1 ? "file" : "files"}`}
					</p>
				</div>
				<Button ref={triggerRef} variant="secondary" onClick={() => setOpen(true)}>
					Open preview
				</Button>
			</div>
			{open ? (
				<Dialog
					size="lg"
					title={name}
					triggerRef={triggerRef}
					closeLabel="Close preview"
					onClose={() => setOpen(false)}
					description="Read-only draft preview"
					placement={edge.compact ? "sheet" : "center"}
					footer={
						page.data == null ? undefined : (
							<AssistantPageSave
								{...props}
								name={page.data.name}
								onNavigate={(href) => {
									setOpen(false);
									void navigate({ href });
								}}
							/>
						)
					}
				>
					<div className="grid gap-4">
						<Tabs
							value={tab}
							options={tabs}
							panelId={panelId}
							onChange={setTab}
							label="Draft view"
						/>
						<div id={panelId} role="tabpanel" aria-labelledby={tabId(panelId, tab)}>
							{tab === "preview" ? (
								<div className="h-[min(60vh,32rem)] overflow-hidden rounded-lg border border-border">
									<EmbeddedPagePreview title={name} identity={props.identity} />
								</div>
							) : (
								<DraftSource pageId={props.identity.pageId} />
							)}
						</div>
					</div>
				</Dialog>
			) : null}
		</>
	);
}
