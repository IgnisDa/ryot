import { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	Button,
	Card,
	DestructiveConfirmation,
	EmptyState,
	Field,
	LoadMoreButton,
	Notice,
	RadioGroup,
	RowGroup,
	SearchField,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon, appIconNames } from "@ryot-app/plugin-ui-sdk/icon";
import type { PageRecord } from "@ryot-app/ryotql-recipes/pages";
import { useNavigate, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { Effect, Schema } from "effect";
import { useRef, useState } from "react";

import { SettingsSection } from "#/modules/settings/settings-section";

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
		<div className="grid gap-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="grid gap-1">
					<p className="text-sm text-text-muted">
						Upload or paste a self-contained page, compile a read-only preview, then publish it and
						add a view to navigation.
					</p>
					<DocsLink />
				</div>
				<Button
					disabled={props.disabled}
					className="shrink-0 self-start"
					onClick={() => setSelected("new")}
				>
					<AppIcon size={15} name="plus" />
					New page
				</Button>
			</div>
			{query.isError && (
				<Notice tone="danger" action={<Button onClick={query.refetch}>Retry</Button>}>
					Pages could not be loaded.
				</Notice>
			)}
			{!query.isPending && !query.isError && pages.length === 0 && (
				<EmptyState
					title="No pages yet"
					description="Create a page to get started."
					icon={<AppIcon size={36} name="file-text" className="text-text-subtle" />}
				/>
			)}
			{pages.length > 0 && (
				<RowGroup>
					{pages.map((page) => (
						<div key={page.id} className="flex items-center justify-between gap-3 px-4 py-3">
							<div className="grid min-w-0 gap-1.5">
								<h2 className="truncate font-semibold text-text">{page.name}</h2>
								<PageStatus
									draftRevision={page.draftRevision}
									publishedRevision={page.publishedRevision}
								/>
							</div>
							<Button
								size="sm"
								variant="secondary"
								aria-label={`Manage ${page.name}`}
								onClick={() => setSelected(page.id)}
							>
								Manage
								<AppIcon size={14} name="chevron-right" />
							</Button>
						</div>
					))}
				</RowGroup>
			)}
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

function DocsLink() {
	return (
		<a
			target="_blank"
			rel="noreferrer"
			href="https://docs.ryot.io/concepts/pages.html"
			className="flex items-center gap-1.5 self-start py-1 text-sm font-medium text-accent-text"
		>
			Read the pages guide
			<AppIcon size={14} name="external-link" />
		</a>
	);
}

function PageStatus(props: {
	readonly slug?: string;
	readonly draftRevision: number;
	readonly origin?: PageRecord["origin"];
	readonly publishedRevision: null | number;
}) {
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{props.slug !== undefined && (
				<Badge variant="outline" className="font-mono">
					{props.slug}
				</Badge>
			)}
			<Badge variant="neutral">Draft {props.draftRevision}</Badge>
			<Badge variant={props.publishedRevision === null ? "neutral" : "success"}>
				{props.publishedRevision === null ? "Unpublished" : `Published ${props.publishedRevision}`}
			</Badge>
			{props.origin !== undefined && (
				<Badge variant="neutral">
					{props.origin === "assistant" ? "Assistant authored" : "User authored"}
				</Badge>
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
	const [viewIcon, setViewIcon] = useState("file-text");
	const [iconQuery, setIconQuery] = useState("");
	const iconOptions = appIconNames
		.filter((value) => value.includes(iconQuery.trim().toLowerCase()))
		.map((value) => ({ value, label: value }));
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
	const draftStatus = () => {
		if (dirty) {
			return "Unsaved changes. Save and compile to preview this definition.";
		}
		if (compiled !== null && !conflict) {
			return "Compiled. Preview is always read-only.";
		}
		return "Saved. Compile to preview this draft.";
	};
	const reason = authoringReason(failure);
	return (
		<div className="grid gap-8">
			<div className="flex items-center justify-between gap-3">
				<Button size="sm" variant="ghost" className="-ml-2.5" onClick={props.onDone}>
					<AppIcon size={15} name="chevron-left" />
					All pages
				</Button>
				<DocsLink />
			</div>
			{page === null ? (
				<SettingsSection title="New page" detail="Name the page and choose its URL slug.">
					<Card className="grid gap-4">
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
									className="font-mono"
									onChange={(event) => setSlug(event.target.value)}
								/>
							)}
						</Field>
					</Card>
				</SettingsSection>
			) : (
				<header className="grid gap-2">
					<h2 className="font-display text-2xl font-semibold text-text">{page.name}</h2>
					<PageStatus
						slug={page.slug}
						origin={page.origin}
						draftRevision={revision}
						publishedRevision={page.publishedRevision}
					/>
				</header>
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
			<div className="grid gap-3">
				<Card className="grid gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<Button
							onClick={save}
							variant={page === null ? "primary" : "secondary"}
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
								{compiled !== null && !dirty && !conflict && (
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
										<AppIcon size={15} name="eye" />
										Preview compiled draft
									</Button>
								)}
								<Button
									className="sm:ml-auto"
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
					{page !== null && (
						<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
							<p role="status" className="text-sm text-text-muted">
								{draftStatus()}
							</p>
							<Button size="sm" disabled={busy} variant="ghost" onClick={props.onReload}>
								Reload latest draft (discard local changes)
							</Button>
						</div>
					)}
				</Card>
				{message !== null && <Notice tone="info">{message}</Notice>}
				{failure !== null && <Notice tone="danger">{authoringFailureText(failure)}</Notice>}
				{reason?.code === "build-failed" && (
					<Card className="overflow-x-auto">
						<ul className="grid gap-2" aria-label="Compile diagnostics">
							{reason.diagnostics.map((diagnostic) => (
								<li
									className="break-words font-mono text-sm text-danger"
									key={`${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.code}:${diagnostic.message}`}
								>
									{diagnostic.file}:{diagnostic.line}:{diagnostic.column} [{diagnostic.code}]{" "}
									{diagnostic.message}
								</li>
							))}
						</ul>
					</Card>
				)}
			</div>
			{page !== null && (
				<>
					<SettingsSection
						title="Write access"
						detail="Published page operations require your grant. Assistant edits revoke it. Previews stay read-only."
					>
						<div className="flex flex-wrap items-center gap-3">
							<Badge dot variant={page.writeAccess ? "success" : "neutral"}>
								{page.writeAccess ? "Granted" : "Not granted"}
							</Badge>
							<Button
								size="sm"
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
					</SettingsSection>
					{page.publishedRevision !== null && (
						<SettingsSection
							title="Navigation"
							detail="Create a saved view of the published page. Query values are controlled by page code."
						>
							<div className="grid gap-2">
								<div className="flex items-center justify-between gap-2">
									<span className="text-sm font-medium text-text">Icon</span>
									<span className="flex items-center gap-1.5 font-mono text-xs text-text-muted">
										<AppIcon size={14} name={viewIcon} />
										{viewIcon}
									</span>
								</div>
								<div className="overflow-hidden rounded-lg border border-border-card bg-surface">
									<div className="border-b border-border p-2">
										<SearchField
											value={iconQuery}
											label="Search icons"
											onChange={setIconQuery}
											placeholder="Search icons"
											icon={<AppIcon size={15} name="search" />}
											clearIcon={<AppIcon name="x" size={14} />}
										/>
									</div>
									{iconOptions.length === 0 ? (
										<p className="px-4 py-6 text-center text-sm text-text-muted">No icons match.</p>
									) : (
										<RadioGroup
											value={viewIcon}
											label="View icon"
											options={iconOptions}
											onChange={setViewIcon}
											className="grid max-h-48 grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1 overflow-y-auto p-2"
											renderOption={(option, selected) => ({
												content: (
													<span
														title={option.value}
														className="flex size-full items-center justify-center"
													>
														<AppIcon size={18} name={option.value} />
													</span>
												),
												className: clsx(
													"flex size-10 items-center justify-center rounded-md",
													selected
														? "bg-accent-soft text-accent-text ring-1 ring-accent-border ring-inset"
														: "text-text-muted hover:bg-hover hover:text-text",
												),
											})}
										/>
									)}
								</div>
							</div>
							<div>
								<Button
									disabled={busy}
									variant="secondary"
									onClick={() => {
										void Effect.runPromise(
											view
												.mutateEffect({
													settings: {},
													icon: viewIcon,
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
						</SettingsSection>
					)}
					<SettingsSection
						title="Delete page"
						detail="The draft and published page are deleted permanently. Remove saved views and publications using this page first."
					>
						<div>
							<Button
								ref={trigger}
								disabled={busy}
								className="-ml-3.5"
								variant="dangerGhost"
								onClick={() => {
									setFailure(null);
									setConfirming(true);
								}}
							>
								<AppIcon size={15} name="trash-2" />
								Delete page
							</Button>
						</div>
					</SettingsSection>
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
