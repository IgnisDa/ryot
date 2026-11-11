import { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	DestructiveConfirmation,
	EmptyState,
	Field,
	LoadMoreButton,
	Notice,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import type { PageRecord } from "@ryot-app/ryotql-recipes/pages";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { useRef, useState } from "react";

import { DefinitionForm } from "./definition-form";
import {
	authoringFailureText,
	authoringReason,
	createPageMutation,
	createPageViewMutation,
	type PageCommand,
	pageCommandMutation,
	pageQuery,
	pagesQuery,
} from "./service";

const initialCursor: string | undefined = undefined;

export function PagesManager(props: { readonly disabled: boolean }) {
	const [selected, setSelected] = useState<null | string>(null);
	const query = useRyotInfiniteQuery(
		pagesQuery,
		{},
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (_, after: string | undefined) => ({ after }),
		},
	);
	const pages = paginationItems(
		query.pages,
		(page) => page.items,
		(page) => page.id,
	);
	if (selected === "new") {
		return (
			<PageEditor
				page={null}
				onSaved={setSelected}
				disabled={props.disabled}
				onDone={() => setSelected(null)}
			/>
		);
	}
	if (selected !== null) {
		return (
			<PageDetails pageId={selected} disabled={props.disabled} onDone={() => setSelected(null)} />
		);
	}
	return (
		<div className="grid gap-4">
			<p className="text-sm text-text-muted">
				Upload or paste a self-contained page, compile a read-only preview, then publish it and add
				a view to navigation.
			</p>
			<div>
				<Button disabled={props.disabled} onClick={() => setSelected("new")}>
					New page
				</Button>
			</div>
			{query.isError && (
				<Notice tone="danger" action={<Button onClick={query.refetch}>Retry</Button>}>
					Pages could not be loaded.
				</Notice>
			)}
			{!query.isPending && !query.isError && pages.length === 0 && (
				<EmptyState title="No pages yet" description="Create a page to get started." />
			)}
			{pages.map((page) => (
				<Card key={page.id} className="grid gap-2">
					<h2 className="font-semibold">{page.name}</h2>
					<p className="text-sm text-text-muted">
						Draft {page.draftRevision} ·{" "}
						{page.publishedRevision === null
							? "Unpublished"
							: `Published ${page.publishedRevision}`}
					</p>
					<div>
						<Button variant="secondary" onClick={() => setSelected(page.id)}>
							Manage {page.name}
						</Button>
					</div>
				</Card>
			))}
			{query.data?.pageInfo.hasMore === true && (
				<LoadMoreButton
					label="Load more"
					onClick={query.fetchNextPage}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			)}
		</div>
	);
}

function PageDetails(props: {
	readonly pageId: string;
	readonly disabled: boolean;
	readonly onDone: () => void;
}) {
	const [reload, setReload] = useState(0);
	const query = useRyotQuery(pageQuery, { reload, pageId: props.pageId });
	if (query.isError) {
		return (
			<Notice tone="danger" action={<Button onClick={query.refetch}>Retry</Button>}>
				This page could not be loaded.
			</Notice>
		);
	}
	if (query.data === undefined) {
		return <p role="status">Loading page…</p>;
	}
	if (query.data === null) {
		return <Notice tone="danger">This page no longer exists.</Notice>;
	}
	return (
		<PageEditor
			page={query.data}
			onDone={props.onDone}
			disabled={props.disabled}
			onRefresh={query.refetch}
			key={`${props.pageId}:${reload}`}
			onReload={() => setReload((value) => value + 1)}
		/>
	);
}

function PageEditor(props: {
	readonly disabled: boolean;
	readonly onDone: () => void;
	readonly onReload?: () => void;
	readonly onRefresh?: () => void;
	readonly page: null | PageRecord;
	readonly onSaved?: (pageId: string) => void;
}) {
	const page = props.page;
	const navigate = useNavigate();
	const router = useRouter();
	const create = useRyotMutation(createPageMutation);
	const command = useRyotMutation(pageCommandMutation);
	const view = useRyotMutation(createPageViewMutation);
	const [name, setName] = useState(page?.name ?? "");
	const [slug, setSlug] = useState(page?.slug ?? "");
	const [entry, setEntry] = useState(page?.draftDefinition.entry ?? "client/page.tsx");
	const [dependencies, setDependencies] = useState(
		JSON.stringify(page?.draftDefinition.pluginDependencies ?? {}, null, 2),
	);
	const [queries, setQueries] = useState(
		JSON.stringify(page?.draftDefinition.queries ?? { queries: {} }, null, 2),
	);
	const [files, setFiles] = useState<PageDefinition["files"]>(page?.draftDefinition.files ?? []);
	const [revision, setRevision] = useState(page?.draftRevision ?? 0);
	const [dirty, setDirty] = useState(page === null);
	const [compiled, setCompiled] = useState(
		page !== null &&
			page.draftCompiledRevision === page.draftRevision &&
			page.draftArtifactHash !== null
			? {
					pageId: page.id,
					draftRevision: page.draftRevision,
					artifactHash: page.draftArtifactHash,
					definitionHash: page.draftDefinitionHash,
				}
			: null,
	);
	const [failure, setFailure] = useState<unknown>(null);
	const [message, setMessage] = useState<null | string>(null);
	const [conflict, setConflict] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const busy = props.disabled || create.isPending || command.isPending || view.isPending;
	const changed = () => {
		setFailure(null);
		setDirty(true);
		setCompiled(null);
		setMessage(null);
	};
	const fail = (error: unknown) => {
		setFailure(error);
		setMessage(null);
		if (authoringReason(error)?.code === "draft-revision-stale") {
			setConflict(true);
			setCompiled(null);
		}
	};
	const run = (input: PageCommand, success: () => void) => {
		setFailure(null);
		setMessage(null);
		void Effect.runPromise(
			command.mutateEffect(input).pipe(Effect.match({ onFailure: fail, onSuccess: success })),
		);
	};
	const save = () => {
		setFailure(null);
		setMessage(null);
		const decode = Effect.all({
			queries: Schema.decodeEffect(Schema.fromJsonString(PageDefinition.fields.queries))(queries),
			pluginDependencies: Schema.decodeEffect(
				Schema.fromJsonString(PageDefinition.fields.pluginDependencies),
			)(dependencies),
		}).pipe(Effect.map((values) => ({ ...values, entry, files })));

		void Effect.runPromise(
			decode.pipe(
				Effect.matchEffect({
					onFailure: () =>
						Effect.sync(() =>
							setMessage(
								"Check the entry, files, plugin dependencies and declared queries. Enter valid JSON matching the page definition.",
							),
						),
					onSuccess: (definition) =>
						(page === null
							? create
									.mutateEffect({ name, slug, definition })
									.pipe(Effect.tap((result) => Effect.sync(() => props.onSaved?.(result.pageId))))
							: command
									.mutateEffect({
										action: "replaceDraft",
										payload: { definition, pageId: page.id, expectedDraftRevision: revision },
									})
									.pipe(
										Effect.tap(() =>
											Effect.sync(() => {
												setRevision((value) => value + 1);
												setDirty(false);
												setCompiled(null);
												setMessage("Draft saved.");
											}),
										),
									)
						).pipe(Effect.match({ onFailure: fail, onSuccess: () => undefined })),
				}),
			),
		);
	};
	const reason = authoringReason(failure);
	return (
		<div className="grid gap-4">
			<Button variant="ghost" onClick={props.onDone}>
				All pages
			</Button>
			<Card className="grid gap-4">
				{page === null ? (
					<>
						<Field label="Name">
							{(control) => (
								<TextField
									{...control}
									required
									value={name}
									disabled={busy}
									onChange={(event) => setName(event.target.value)}
								/>
							)}
						</Field>
						<Field label="Slug">
							{(control) => (
								<TextField
									{...control}
									required
									value={slug}
									disabled={busy}
									onChange={(event) => setSlug(event.target.value)}
								/>
							)}
						</Field>
					</>
				) : (
					<>
						<h2 className="font-semibold">{page.name}</h2>
						<p className="text-sm text-text-muted">
							{page.slug} · Draft {revision} ·{" "}
							{page.publishedRevision === null
								? "Unpublished"
								: `Published ${page.publishedRevision}`}{" "}
							· {page.origin === "assistant" ? "Assistant authored" : "User authored"}
						</p>
					</>
				)}
				<DefinitionForm
					entry={entry}
					files={files}
					queries={queries}
					onError={setMessage}
					dependencies={dependencies}
					disabled={busy || conflict}
					onEntry={(value) => {
						changed();
						setEntry(value);
					}}
					onFiles={(value) => {
						changed();
						setFiles(value);
					}}
					onQueries={(value) => {
						changed();
						setQueries(value);
					}}
					onDependencies={(value) => {
						changed();
						setDependencies(value);
					}}
				/>
				<div className="flex flex-wrap gap-2">
					<Button
						onClick={save}
						disabled={busy || conflict || !dirty || name.trim() === "" || slug.trim() === ""}
					>
						{page === null ? "Create draft" : "Save draft"}
					</Button>
					{page !== null && (
						<>
							<Button
								variant="secondary"
								disabled={busy || dirty || conflict}
								onClick={() =>
									run(
										{
											action: "compile",
											payload: { pageId: page.id, expectedDraftRevision: revision },
										},
										() => {
											props.onReload?.();
										},
									)
								}
							>
								Compile draft
							</Button>
							<Button
								disabled={busy || dirty || conflict}
								onClick={() =>
									run(
										{
											action: "publish",
											payload: { pageId: page.id, expectedDraftRevision: revision },
										},
										() => {
											setMessage("Page published.");
											props.onReload?.();
										},
									)
								}
							>
								Publish
							</Button>
						</>
					)}
				</div>
				{dirty && page !== null && (
					<p role="status" className="text-sm text-text-muted">
						Unsaved changes. Save and compile to preview this definition.
					</p>
				)}
				{compiled !== null && !dirty && !conflict && (
					<div>
						<Button
							variant="secondary"
							onClick={() =>
								void navigate({
									to: "/page-preview/$pageId",
									params: { pageId: compiled.pageId },
									search: {
										artifactHash: compiled.artifactHash,
										draftRevision: compiled.draftRevision,
										definitionHash: compiled.definitionHash,
									},
								})
							}
						>
							Preview compiled draft
						</Button>
						<p className="text-sm text-text-muted">Preview is always read-only.</p>
					</div>
				)}
			</Card>
			{message !== null && <Notice tone="info">{message}</Notice>}
			{failure !== null && <Notice tone="danger">{authoringFailureText(failure)}</Notice>}
			{reason?.code === "build-failed" && (
				<ul className="grid gap-2" aria-label="Compile diagnostics">
					{reason.diagnostics.map((diagnostic) => (
						<li
							className="break-words font-mono text-sm"
							key={`${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.code}:${diagnostic.message}`}
						>
							{diagnostic.file}:{diagnostic.line}:{diagnostic.column} [{diagnostic.code}]{" "}
							{diagnostic.message}
						</li>
					))}
				</ul>
			)}
			{page !== null && (
				<>
					<Button disabled={busy} variant="secondary" onClick={props.onReload}>
						Reload latest draft (discard local changes)
					</Button>
					<Card className="grid gap-3">
						<h3 className="font-semibold">Write access</h3>
						<p className="text-sm text-text-muted">
							{page.writeAccess ? "Granted" : "Not granted"}. Published page operations require your
							grant. Assistant edits revoke it. Previews stay read-only.
						</p>
						<div>
							<Button
								disabled={busy}
								variant="secondary"
								onClick={() =>
									run(
										{
											action: "setWriteAccess",
											payload: { pageId: page.id, writeAccess: !page.writeAccess },
										},
										() => props.onRefresh?.(),
									)
								}
							>
								{page.writeAccess ? "Revoke write access" : "Grant write access"}
							</Button>
						</div>
					</Card>
					{page.publishedRevision !== null && (
						<Card className="grid gap-3">
							<h3 className="font-semibold">Navigation</h3>
							<p className="text-sm text-text-muted">
								Create a saved view of the published page. Query values are controlled by page code.
							</p>
							<div>
								<Button
									disabled={busy}
									onClick={() => {
										void Effect.runPromise(
											view
												.mutateEffect({
													icon: "file",
													settings: {},
													name: page.name,
													dataSources: null,
													renderer: { kind: "page", pageId: page.id },
												})
												.pipe(
													Effect.flatMap((result) =>
														Effect.promise(() => navigate({ href: `/v/c/${result.id}` })).pipe(
															Effect.andThen(Effect.promise(() => router.invalidate())),
														),
													),
													Effect.match({ onFailure: fail, onSuccess: () => undefined }),
												),
										);
									}}
								>
									Create view and open
								</Button>
							</div>
						</Card>
					)}
					<Button
						ref={trigger}
						disabled={busy}
						variant="dangerGhost"
						onClick={() => {
							setFailure(null);
							setConfirming(true);
						}}
					>
						Delete page
					</Button>
					{confirming && (
						<DestructiveConfirmation
							triggerRef={trigger}
							pendingLabel="Deleting…"
							title="Delete this page?"
							actionLabel="Delete page"
							pending={command.isPending}
							onClose={() => setConfirming(false)}
							errorMessage={failure === null ? undefined : authoringFailureText(failure)}
							onConfirm={() =>
								run({ action: "delete", payload: { pageId: page.id } }, props.onDone)
							}
							detail="The draft and published page are deleted permanently. Remove saved views and publications using this page first."
						/>
					)}
				</>
			)}
		</div>
	);
}
