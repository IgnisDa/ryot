import {
	bindPublicationArguments,
	publicationOwnerSchema,
} from "@ryot-app/contract/modules/publications/bindings";
import type { PublicationMode } from "@ryot-app/contract/modules/publications/schemas";
import {
	type ParameterExposureRisk,
	parameterExposureRisk,
} from "@ryot-app/contract/modules/ryotql/parameters";
import { PublicationId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
	Select,
	Switch,
	TextArea,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	initialSchemaFormValues,
	SchemaForm,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { kernelPublicationVisitorParameters } from "@ryot-app/ryotql-recipes/publication-browse";
import type { PublicationSummary } from "@ryot-app/ryotql-recipes/publications";
import { Effect, Result } from "effect";
import { useRef, useState } from "react";

import type { AuthenticatedApiError } from "#/api/authenticated";
import type { ServerOrigin } from "#/api/origin";
import { schemaFormIcons } from "#/modules/ui/schema-form-icons";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { useFormSeed } from "#/modules/ui/use-form-seed";

import { PublicationDetailsFields } from "./details-fields";
import { publicationFailureText, PublicationLinks } from "./links";
import { PublicationModeField } from "./mode-field";
import { usePublicationPreview } from "./preview";
import {
	createPublicationMutation,
	publicationCommandMutation,
	publicationPageQuery,
	publicationPagesQuery,
	PUBLICATIONS_PAGE_SIZE,
	publicationsQuery,
} from "./service";
import { PublicationHeader } from "./status";

const initialCursor: string | undefined = undefined;

export function PublicationPageEditor(props: {
	readonly pageId: string;
	readonly disabled: boolean;
	readonly onDone: () => void;
	readonly publication: null | PublicationSummary;
	readonly onCreated?: (publicationId: string) => void;
}) {
	const t = useT();
	const page = useRyotQuery(publicationPageQuery, { arguments: { pageId: props.pageId } });
	if (page.data?.publishedDefinition == null) {
		return (
			<>
				<Notice tone={page.isError ? "danger" : "info"}>
					{t(
						page.isPending
							? kernelMessage("client.page-authoring.page.loading")
							: kernelMessage("client.publications.error.page-unavailable"),
					)}
				</Notice>
				<Button variant="ghost" onClick={props.onDone}>
					{t(kernelMessage("common.action.cancel"))}
				</Button>
			</>
		);
	}
	return (
		<PublicationEditorForm
			{...props}
			page={{ kind: "page", pageId: props.pageId }}
			schema={page.data.publishedDefinition.queries.parameters ?? { fields: {} }}
		/>
	);
}

export function PublicationsManager(props: {
	readonly disabled: boolean;
	readonly serverUrl: ServerOrigin;
}) {
	const t = useT();
	const [editing, setEditing] = useState<null | "new" | PublicationSummary>(null);
	const query = useRyotInfiniteQuery(
		publicationsQuery,
		{ limit: PUBLICATIONS_PAGE_SIZE },
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after }),
		},
	);
	const publications = paginationItems(
		query.pages,
		(page) => page.items,
		(publication) => publication.id,
	);

	if (editing !== null) {
		return (
			<PublicationEditor
				disabled={props.disabled}
				onDone={() => setEditing(null)}
				publication={editing === "new" ? null : editing}
			/>
		);
	}

	return (
		<div className="grid gap-4">
			<p className="text-sm text-text-muted">
				{t(kernelMessage("client.publications.manager.intro"))}
			</p>
			<div>
				<Button disabled={props.disabled} onClick={() => setEditing("new")}>
					{t(kernelMessage("client.publications.manager.new"))}
				</Button>
			</div>
			{query.isError && publications.length === 0 ? (
				<Notice
					tone="danger"
					action={
						<Button onClick={query.refetch}>{t(kernelMessage("common.action.retry"))}</Button>
					}
				>
					{t(kernelMessage("client.publications.manager.load-failed"))}
				</Notice>
			) : null}
			{!query.isPending && !query.isError && publications.length === 0 ? (
				<EmptyState
					title={t(kernelMessage("client.publications.manager.empty.title"))}
					description={t(kernelMessage("client.publications.manager.empty.description"))}
				/>
			) : null}
			{publications.map((publication) => (
				<PublicationCard
					key={publication.id}
					disabled={props.disabled}
					publication={publication}
					serverUrl={props.serverUrl}
					onEdit={() => setEditing(publication)}
				/>
			))}
			{query.data?.pageInfo.hasMore === true && (
				<LoadMoreButton
					onClick={query.fetchNextPage}
					disabled={query.isFetchingNextPage}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			)}
		</div>
	);
}

function PublicationEditor(props: {
	readonly disabled: boolean;
	readonly onDone: () => void;
	readonly publication: null | PublicationSummary;
}) {
	const t = useT();
	const pages = useRyotInfiniteQuery(
		publicationPagesQuery,
		{ arguments: {} },
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({
				...input,
				pages: { pages: { after, limit: 100 } },
			}),
		},
	);
	const available = paginationItems(
		pages.pages,
		(page) => page.items,
		(page) => page.id,
	).filter((page) => page.publishedRevision !== null);
	const initial = props.publication?.definition.page;
	const [selected, setSelected] = useState(() => {
		if (initial?.kind === "page") {
			return initial.pageId;
		}
		return initial?.kind === "kernel" ? "kernel" : "";
	});
	let content = (
		<Button variant="ghost" onClick={props.onDone}>
			{t(kernelMessage("common.action.cancel"))}
		</Button>
	);
	if (selected === "kernel" && props.publication?.definition.page.kind === "kernel") {
		content = (
			<PublicationEditorForm
				key={selected}
				{...props}
				schema={{ fields: {} }}
				page={props.publication.definition.page}
			/>
		);
	} else if (selected !== "") {
		content = <PublicationPageEditor key={selected} {...props} pageId={selected} />;
	}

	return (
		<Card className="grid gap-4">
			<Select
				value={selected}
				onChange={setSelected}
				disabled={props.disabled}
				checkIcon={<AppIcon size={16} name="check" />}
				chevronIcon={<AppIcon size={16} name="chevron-down" />}
				label={t(kernelMessage("client.publications.manager.page"))}
				placeholder={t(kernelMessage("client.publications.manager.choose-page"))}
				choices={[
					...(initial?.kind === "kernel"
						? [
								{
									value: "kernel",
									label: t(kernelMessage("client.publications.manager.kernel-page")),
								},
							]
						: []),
					...(initial?.kind === "page" && !available.some((page) => page.id === initial.pageId)
						? [
								{
									value: initial.pageId,
									label: t(kernelMessage("client.publications.manager.current-page")),
								},
							]
						: []),
					...available.map((page) => ({ value: page.id, label: formatDisplayText(t, page.name) })),
				]}
			/>
			{pages.isError ? (
				<Notice
					tone="danger"
					action={
						<Button onClick={pages.refetch}>{t(kernelMessage("common.action.retry"))}</Button>
					}
				>
					{t(kernelMessage("client.page-authoring.list.load-failed"))}
				</Notice>
			) : null}
			{pages.data?.pageInfo.hasMore === true ? (
				<LoadMoreButton
					onClick={pages.fetchNextPage}
					isFetchingNextPage={pages.isFetchingNextPage}
					label={t(kernelMessage("client.publications.manager.load-more-pages"))}
				/>
			) : null}
			<p className="text-sm text-text-muted">
				{t(kernelMessage("client.publications.manager.page-help"))}
			</p>
			{content}
		</Card>
	);
}

function PublicationCard(props: {
	readonly disabled: boolean;
	readonly onEdit: () => void;
	readonly serverUrl: ServerOrigin;
	readonly publication: PublicationSummary;
}) {
	const t = useT();
	const formatters = useFormatters();
	const { publication } = props;
	const command = useRyotMutation(publicationCommandMutation);
	const preview = usePublicationPreview();
	const [confirming, setConfirming] = useState<null | "delete" | "revoke">(null);
	const confirmTrigger = useRef<null | HTMLButtonElement>(null);
	const active = publication.revokedAt === null;
	const payload = { publicationId: PublicationId.make(publication.id) };
	const confirm = (action: "delete" | "revoke", trigger: HTMLButtonElement) => {
		confirmTrigger.current = trigger;
		setConfirming(action);
	};
	const closeConfirmation = () => {
		command.reset();
		setConfirming(null);
	};
	const confirmation =
		confirming === "revoke"
			? {
					title: t(kernelMessage("client.publications.manager.stop-title")),
					detail: t(kernelMessage("client.publications.manager.stop-detail")),
					pendingLabel: t(kernelMessage("client.publications.manager.stopping")),
					actionLabel: t(kernelMessage("client.publications.manager.stop-sharing")),
				}
			: {
					pendingLabel: t(kernelMessage("common.status.deleting")),
					title: t(kernelMessage("client.publications.manager.delete-title")),
					detail: t(kernelMessage("client.publications.manager.delete-detail")),
					actionLabel: t(kernelMessage("client.publications.manager.delete-action")),
				};
	return (
		<Card className="grid gap-4" id={`publication-${publication.id}`}>
			<PublicationHeader heading="h2" publication={publication} />
			<p className="text-sm text-text-muted">
				{t(
					publication.definition.mode === "snapshot"
						? kernelMessage("client.publications.manager.snapshot-summary")
						: kernelMessage("client.publications.manager.live-summary"),
				)}
			</p>
			{publication.description === null ? null : (
				<p className="text-sm text-text-muted">{publication.description}</p>
			)}
			{active && (
				<PublicationLinks
					disabled={props.disabled}
					publication={publication}
					serverUrl={props.serverUrl}
				/>
			)}
			<div className="flex flex-wrap gap-2 border-t border-border pt-4">
				{active && (
					<>
						<Button
							size="sm"
							variant="secondary"
							disabled={preview.isPending}
							onClick={() => preview.open(publication.id)}
						>
							<AppIcon size={16} name="eye" />
							{t(kernelMessage("client.publications.manager.preview"))}
						</Button>
						<Button
							size="sm"
							variant="secondary"
							disabled={props.disabled || command.isPending}
							onClick={() =>
								void Effect.runPromise(
									command
										.mutateEffect({
											action: "republish",
											request: {
												payload: {
													...publication.definition,
													icon: publication.icon,
													title: publication.title,
													publicationId: publication.id,
													description: publication.description,
													showOwnerName: publication.showOwnerName,
												},
											},
										})
										.pipe(Effect.ignore),
								)
							}
						>
							{t(kernelMessage("common.action.refresh"))}
						</Button>
						<Button size="sm" variant="secondary" onClick={props.onEdit} disabled={props.disabled}>
							{t(kernelMessage("client.publications.manager.edit"))}
						</Button>
						<Button
							size="sm"
							variant="dangerGhost"
							disabled={props.disabled}
							onClick={(event) => confirm("revoke", event.currentTarget)}
						>
							{t(kernelMessage("client.publications.manager.stop-sharing"))}
						</Button>
					</>
				)}
				<Button
					size="sm"
					variant="dangerGhost"
					disabled={props.disabled}
					onClick={(event) => confirm("delete", event.currentTarget)}
				>
					{t(kernelMessage("common.action.delete"))}
				</Button>
			</div>
			{command.error === null || confirming !== null ? null : (
				<Notice tone="danger">{publicationFailureText(t, formatters, command.error)}</Notice>
			)}
			{confirming === null ? null : (
				<DestructiveConfirmation
					{...confirmation}
					onClose={closeConfirmation}
					triggerRef={confirmTrigger}
					pending={command.isPending}
					errorMessage={
						command.error === null
							? undefined
							: publicationFailureText(t, formatters, command.error)
					}
					onConfirm={() =>
						void Effect.runPromise(
							command
								.mutateEffect({ action: confirming, request: { payload } })
								.pipe(
									Effect.match({
										onFailure: () => undefined,
										onSuccess: () => setConfirming(null),
									}),
								),
						)
					}
				/>
			)}
		</Card>
	);
}

const exposureRiskText: Record<ParameterExposureRisk, null | Message> = {
	bounded: null,
	"free-text": kernelMessage("client.publications.manager.risk.free-text"),
	identifier: kernelMessage("client.publications.manager.risk.identifier"),
};

function PublicationEditorForm(props: {
	readonly disabled: boolean;
	readonly schema: AppSchema;
	readonly onDone: () => void;
	readonly publication: null | PublicationSummary;
	readonly onCreated?: (publicationId: string) => void;
	readonly page: PublicationSummary["definition"]["page"];
}) {
	const t = useT();
	const formatters = useFormatters();
	const create = useRyotMutation(createPublicationMutation);
	const command = useRyotMutation(publicationCommandMutation);
	const [title, setTitle] = useState(props.publication?.title ?? "");
	const [description, setDescription] = useState(props.publication?.description ?? "");
	const [showOwnerName, setShowOwnerName] = useState(props.publication?.showOwnerName ?? false);
	const [mode, setMode] = useState<PublicationMode>(props.publication?.definition.mode ?? "live");
	const [error, setError] = useState<null | string>(null);
	const uploadFile = useSchemaFileUpload();
	const current = props.publication?.definition;
	const samePage =
		props.page.kind === "kernel"
			? current?.page.kind === "kernel"
			: current?.page.kind === "page" && props.page.pageId === current.page.pageId;
	const bound = samePage ? (current?.arguments ?? {}) : {};
	const [visitorChoices, setVisitorChoices] = useState<readonly string[]>(() =>
		samePage ? (current?.visitorParameters ?? []) : [],
	);
	let visitorParameters = mode === "live" ? visitorChoices : [];
	if (props.page.kind === "kernel") {
		visitorParameters = kernelPublicationVisitorParameters(mode);
	}
	const ownerSchema = publicationOwnerSchema(props.schema, visitorParameters);
	const save = (argumentsValue: Record<string, JsonValue>) => {
		const details = {
			mode,
			title,
			showOwnerName,
			page: props.page,
			visitorParameters,
			arguments: argumentsValue,
			icon: props.publication?.icon ?? "file-text",
			description: description.trim() === "" ? null : description,
		};
		const effect: Effect.Effect<null | string, AuthenticatedApiError> =
			props.publication === null
				? create.mutateEffect(details).pipe(Effect.map(({ publicationId }) => publicationId))
				: command
						.mutateEffect({
							action: "republish",
							request: { payload: { ...details, publicationId: props.publication.id } },
						})
						.pipe(Effect.as(null));
		setError(null);
		void Effect.runPromise(
			effect.pipe(
				Effect.match({
					onFailure: (failure) => setError(publicationFailureText(t, formatters, failure)),
					onSuccess: (result) => {
						if (result !== null && props.onCreated !== undefined) {
							props.onCreated(result);
						} else {
							props.onDone();
						}
					},
				}),
			),
		);
	};
	const form = useSchemaForm({
		schemas: [ownerSchema],
		onSubmit: (values) => {
			if (props.page.kind === "kernel") {
				save(bound);
				return;
			}
			const payload = toSchemaFormPayload(ownerSchema, values);
			const parsed = bindPublicationArguments(props.schema, {
				mode,
				visitorParameters,
				arguments: payload,
			});
			if (Result.isFailure(parsed)) {
				setError(
					formatters
						.list({ type: "unit", style: "long" })
						.format(parsed.failure.map((issue) => issue.message)),
				);
				return;
			}
			save(payload);
		},
	});
	useFormSeed(form, "bindings", () => initialSchemaFormValues(props.schema, undefined, bound));
	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<PublicationDetailsFields
				title={title}
				onTitleChange={setTitle}
				showOwnerName={showOwnerName}
				onShowOwnerNameChange={setShowOwnerName}
			>
				<Field optional label={t(kernelMessage("client.publications.details.description"))}>
					{(control) => (
						<TextArea
							{...control}
							rows={2}
							maxLength={2000}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					)}
				</Field>
			</PublicationDetailsFields>
			{props.page.kind === "page" && Object.keys(props.schema.fields).length > 0 ? (
				<div className="grid gap-2">
					<p className="text-sm text-text-muted">
						{t(kernelMessage("client.publications.manager.arguments-help"))}
					</p>
					<fieldset className="grid gap-3" disabled={props.disabled}>
						{Object.entries(props.schema.fields).map(([key, field]) => {
							const risk = exposureRiskText[parameterExposureRisk(field)];
							const changeLabel = t(
								kernelMessage("client.publications.manager.visitors-can-change", {
									label: field.label,
								}),
							);
							return (
								<div key={key} className="grid gap-1">
									<div className="flex items-center justify-between gap-3">
										<span className="text-sm text-text">{changeLabel}</span>
										<Switch
											label={changeLabel}
											disabled={mode === "snapshot"}
											checked={visitorParameters.includes(key)}
											onChange={(checked) =>
												setVisitorChoices((choices) =>
													checked ? [...choices, key] : choices.filter((choice) => choice !== key),
												)
											}
										/>
									</div>
									{risk === null ? null : <span className="text-xs text-warning">{t(risk)}</span>}
								</div>
							);
						})}
						<SchemaForm
							form={form}
							schema={ownerSchema}
							icons={schemaFormIcons}
							uploadFile={uploadFile}
							onChange={() => undefined}
						/>
					</fieldset>
				</div>
			) : null}
			<PublicationModeField value={mode} onChange={setMode} />
			{error === null ? null : <Notice tone="danger">{error}</Notice>}
			<div className="flex gap-2">
				<Button type="submit" disabled={props.disabled || create.isPending || command.isPending}>
					{t(
						props.publication === null
							? kernelMessage("client.page-authoring.publish")
							: kernelMessage("client.publications.manager.save-republish"),
					)}
				</Button>
				<Button type="button" variant="ghost" onClick={props.onDone}>
					{t(kernelMessage("common.action.cancel"))}
				</Button>
			</div>
		</form>
	);
}
