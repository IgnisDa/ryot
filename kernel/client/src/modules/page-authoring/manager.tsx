import { PageDefinition, PagePluginQueries } from "@ryot-app/contract/modules/pages/schemas";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
	EntitlementNotice,
	LoadMoreButton,
	Notice,
	RadioGroup,
	RowGroup,
	SearchField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon, appIconNames } from "@ryot-app/plugin-ui-sdk/icon";
import type { PageRecord } from "@ryot-app/ryotql-recipes/pages";
import { useNavigate, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { Effect, Schema } from "effect";
import { useRef, useState } from "react";

import { useEntitlement } from "#/modules/entitlements/context";
import { SettingsSection } from "#/modules/settings/settings-section";

import { DefinitionForm } from "./definition-form";
import { PageIdentityFields, usePageIdentity } from "./identity-fields";
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
	const t = useT();
	const [selected, setSelected] = useState<null | string>(null);
	const pro = useEntitlement("pro");
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
						{t(kernelMessage("client.page-authoring.intro"))}
					</p>
					<DocsLink />
				</div>
				<Button
					className="shrink-0 self-start"
					disabled={props.disabled || !pro}
					onClick={() => setSelected("new")}
				>
					<AppIcon size={15} name="plus" />
					{t(kernelMessage("client.page-authoring.new"))}
				</Button>
			</div>
			{pro ? null : (
				<EntitlementNotice
					entitlement="pro"
					icon={<AppIcon size={16} name="file-text" />}
					detail={t(kernelMessage("client.page-authoring.pro-required"))}
				/>
			)}
			{query.isError && (
				<Notice
					tone="danger"
					action={
						<Button onClick={query.refetch}>{t(kernelMessage("common.action.retry"))}</Button>
					}
				>
					{t(kernelMessage("client.page-authoring.list.load-failed"))}
				</Notice>
			)}
			{!query.isPending && !query.isError && pages.length === 0 && (
				<EmptyState
					title={t(kernelMessage("client.page-authoring.list.empty-title"))}
					description={t(kernelMessage("client.page-authoring.list.empty-detail"))}
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
								onClick={() => setSelected(page.id)}
								aria-label={t(
									kernelMessage("client.page-authoring.list.manage-label", { name: page.name }),
								)}
							>
								{t(kernelMessage("client.page-authoring.list.manage"))}
								<AppIcon size={14} name="chevron-right" />
							</Button>
						</div>
					))}
				</RowGroup>
			)}
			{query.data?.pageInfo.hasMore === true && (
				<LoadMoreButton
					onClick={query.fetchNextPage}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			)}
		</div>
	);
}

function DocsLink() {
	const t = useT();
	return (
		<a
			target="_blank"
			rel="noreferrer"
			href="https://docs.ryot.io/concepts/pages.html"
			className="flex items-center gap-1.5 self-start py-1 text-sm font-medium text-accent-text"
		>
			{t(kernelMessage("client.page-authoring.guide"))}
			<AppIcon size={14} name="external-link" />
		</a>
	);
}

function PageDetails(props: {
	readonly pageId: string;
	readonly disabled: boolean;
	readonly onDone: () => void;
}) {
	const t = useT();
	const [reload, setReload] = useState(0);
	const query = useRyotQuery(pageQuery, { reload, pageId: props.pageId });
	if (query.isError) {
		return (
			<Notice
				tone="danger"
				action={<Button onClick={query.refetch}>{t(kernelMessage("common.action.retry"))}</Button>}
			>
				{t(kernelMessage("client.page-authoring.page.load-failed"))}
			</Notice>
		);
	}
	if (query.data === undefined) {
		return <p role="status">{t(kernelMessage("client.page-authoring.page.loading"))}</p>;
	}
	if (query.data === null) {
		return (
			<Notice tone="danger">{t(kernelMessage("client.page-authoring.error.not-found"))}</Notice>
		);
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

function PageStatus(props: {
	readonly slug?: string;
	readonly draftRevision: number;
	readonly origin?: PageRecord["origin"];
	readonly publishedRevision: null | number;
}) {
	const t = useT();
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{props.slug !== undefined && (
				<Badge variant="outline" className="font-mono">
					{props.slug}
				</Badge>
			)}
			<Badge variant="neutral">
				{t(kernelMessage("client.page-authoring.status.draft", { revision: props.draftRevision }))}
			</Badge>
			<Badge variant={props.publishedRevision === null ? "neutral" : "success"}>
				{t(
					props.publishedRevision === null
						? kernelMessage("client.page-authoring.status.unpublished")
						: kernelMessage("client.page-authoring.status.published", {
								revision: props.publishedRevision,
							}),
				)}
			</Badge>
			{props.origin !== undefined && (
				<Badge variant="neutral">
					{t(kernelMessage("client.page-authoring.status.origin", { origin: props.origin }))}
				</Badge>
			)}
		</div>
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
	const t = useT();
	const navigate = useNavigate();
	const router = useRouter();
	const create = useRyotMutation(createPageMutation);
	const command = useRyotMutation(pageCommandMutation);
	const view = useRyotMutation(createPageViewMutation);
	const identity = usePageIdentity(page?.name ?? "");
	const { name, slug } = identity;
	const [viewIcon, setViewIcon] = useState("file-text");
	const [iconQuery, setIconQuery] = useState("");
	const iconOptions = appIconNames
		.filter((value) => value.includes(iconQuery.trim().toLowerCase()))
		.map((value) => ({ value, label: formatDisplayText(t, value) }));
	const [entry, setEntry] = useState(page?.draftDefinition.entry ?? "client/page.tsx");
	const [dependencies, setDependencies] = useState(
		JSON.stringify(page?.draftDefinition.pluginDependencies ?? {}, null, 2),
	);
	const [queries, setQueries] = useState(
		JSON.stringify(page?.draftDefinition.queries ?? { queries: {} }, null, 2),
	);
	const [pluginQueries, setPluginQueries] = useState(
		JSON.stringify(page?.draftDefinition.pluginQueries ?? {}, null, 2),
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
	const [message, setMessage] = useState<null | Message>(null);
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
			pluginQueries: Schema.decodeEffect(Schema.fromJsonString(PagePluginQueries))(pluginQueries),
			pluginDependencies: Schema.decodeEffect(
				Schema.fromJsonString(PageDefinition.fields.pluginDependencies),
			)(dependencies),
		}).pipe(Effect.map((values) => ({ ...values, entry, files })));

		void Effect.runPromise(
			decode.pipe(
				Effect.matchEffect({
					onFailure: () =>
						Effect.sync(() =>
							setMessage(kernelMessage("client.page-authoring.error.save-invalid")),
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
												setMessage(kernelMessage("client.page-authoring.draft-saved"));
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
			return kernelMessage("client.page-authoring.draft-status.unsaved");
		}
		if (compiled !== null && !conflict) {
			return kernelMessage("client.page-authoring.compiled-draft");
		}
		return kernelMessage("client.page-authoring.draft-status.saved");
	};
	const reason = authoringReason(failure);
	return (
		<div className="grid gap-8">
			<div className="flex items-center justify-between gap-3">
				<Button size="sm" variant="ghost" className="-ml-2.5" onClick={props.onDone}>
					<AppIcon size={15} name="chevron-left" />
					{t(kernelMessage("client.page-authoring.all-pages"))}
				</Button>
				<DocsLink />
			</div>
			{page === null ? (
				<SettingsSection
					title={t(kernelMessage("client.page-authoring.new"))}
					detail={t(kernelMessage("client.page-authoring.new-detail"))}
				>
					<Card className="grid gap-4">
						<PageIdentityFields disabled={busy} identity={identity} />
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
				pluginQueries={pluginQueries}
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
				onPluginQueries={(value) => {
					changed();
					setPluginQueries(value);
				}}
			/>
			<div className="grid gap-3">
				<Card className="grid gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<Button
							onClick={save}
							variant={page === null ? "primary" : "secondary"}
							disabled={busy || conflict || !dirty || !identity.complete}
						>
							{t(
								page === null
									? kernelMessage("client.page-authoring.create-draft")
									: kernelMessage("client.page-authoring.save-draft"),
							)}
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
									{t(kernelMessage("client.page-authoring.compile"))}
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
										{t(kernelMessage("client.page-authoring.preview-compiled"))}
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
												setMessage(kernelMessage("client.page-authoring.published"));
												props.onReload?.();
											},
										)
									}
								>
									{t(kernelMessage("client.page-authoring.publish"))}
								</Button>
							</>
						)}
					</div>
					{page !== null && (
						<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
							<p role="status" className="text-sm text-text-muted">
								{t(draftStatus())}
							</p>
							<Button size="sm" disabled={busy} variant="ghost" onClick={props.onReload}>
								{t(kernelMessage("client.page-authoring.reload-latest"))}
							</Button>
						</div>
					)}
				</Card>
				{message !== null && <Notice tone="info">{t(message)}</Notice>}
				{failure !== null && <Notice tone="danger">{authoringFailureText(t, failure)}</Notice>}
				{reason?.code === "build-failed" && (
					<Card className="overflow-x-auto">
						<ul
							className="grid gap-2"
							aria-label={t(kernelMessage("client.page-authoring.compile-diagnostics"))}
						>
							{reason.diagnostics.map((diagnostic) => {
								const location = `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`;
								return (
									<li
										className="break-words font-mono text-sm text-danger"
										key={`${location}:${diagnostic.code}:${diagnostic.message}`}
									>
										{[location, `[${diagnostic.code}]`, diagnostic.message].join(" ")}
									</li>
								);
							})}
						</ul>
					</Card>
				)}
			</div>
			{page !== null && (
				<>
					<SettingsSection
						title={t(kernelMessage("client.page-authoring.write-access.title"))}
						detail={t(kernelMessage("client.page-authoring.write-access.detail"))}
					>
						<div className="flex flex-wrap items-center gap-3">
							<Badge dot variant={page.writeAccess ? "success" : "neutral"}>
								{t(
									page.writeAccess
										? kernelMessage("client.page-authoring.write-access.granted")
										: kernelMessage("client.page-authoring.write-access.not-granted"),
								)}
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
								{t(
									page.writeAccess
										? kernelMessage("client.page-authoring.write-access.revoke")
										: kernelMessage("client.page-authoring.write-access.grant"),
								)}
							</Button>
						</div>
					</SettingsSection>
					{page.publishedRevision !== null && (
						<SettingsSection
							title={t(kernelMessage("client.page-authoring.navigation.title"))}
							detail={t(kernelMessage("client.page-authoring.navigation.detail"))}
						>
							<div className="grid gap-2">
								<div className="flex items-center justify-between gap-2">
									<span className="text-sm font-medium text-text">
										{t(kernelMessage("client.page-authoring.navigation.icon"))}
									</span>
									<span className="flex items-center gap-1.5 font-mono text-xs text-text-muted">
										<AppIcon size={14} name={viewIcon} />
										{viewIcon}
									</span>
								</div>
								<div className="overflow-hidden rounded-lg border border-border-card bg-surface">
									<div className="border-b border-border p-2">
										<SearchField
											value={iconQuery}
											onChange={setIconQuery}
											icon={<AppIcon size={15} name="search" />}
											clearIcon={<AppIcon name="x" size={14} />}
											label={t(kernelMessage("client.page-authoring.navigation.search-icons"))}
											placeholder={t(
												kernelMessage("client.page-authoring.navigation.search-icons"),
											)}
										/>
									</div>
									{iconOptions.length === 0 ? (
										<p className="px-4 py-6 text-center text-sm text-text-muted">
											{t(kernelMessage("client.page-authoring.navigation.no-icons"))}
										</p>
									) : (
										<RadioGroup
											value={viewIcon}
											options={iconOptions}
											onChange={setViewIcon}
											label={t(kernelMessage("client.page-authoring.navigation.view-icon"))}
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
									{t(kernelMessage("client.page-authoring.create-view"))}
								</Button>
							</div>
						</SettingsSection>
					)}
					<SettingsSection
						detail={t(kernelMessage("client.page-authoring.delete.detail"))}
						title={t(kernelMessage("client.page-authoring.delete.section-title"))}
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
								{t(kernelMessage("client.page-authoring.delete.action"))}
							</Button>
						</div>
					</SettingsSection>
					{confirming && (
						<DestructiveConfirmation
							triggerRef={trigger}
							pending={command.isPending}
							onClose={() => setConfirming(false)}
							pendingLabel={t(kernelMessage("common.status.deleting"))}
							title={t(kernelMessage("client.page-authoring.delete.title"))}
							detail={t(kernelMessage("client.page-authoring.delete.detail"))}
							actionLabel={t(kernelMessage("client.page-authoring.delete.action"))}
							errorMessage={failure === null ? undefined : authoringFailureText(t, failure)}
							onConfirm={() =>
								run({ action: "delete", payload: { pageId: page.id } }, props.onDone)
							}
						/>
					)}
				</>
			)}
		</div>
	);
}
