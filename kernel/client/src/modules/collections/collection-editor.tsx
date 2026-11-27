import type { ContractRequest } from "@ryot-app/contract/client";
import {
	collectionFieldLimits,
	hasCollectionFieldChoices,
} from "@ryot-app/contract/modules/collections/fields";
import {
	CollectionBadRequest,
	CollectionNotFound,
} from "@ryot-app/contract/modules/collections/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	createRyotHostMutation,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Checkbox,
	DestructiveConfirmation,
	Dialog,
	Field,
	Notice,
	Select,
	TextArea,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { CollectionHeaderResult } from "@ryot-app/ryotql-recipes/collections";
import { useRouter } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";
import { CollectionsApi } from "#/api/collections";
import { KernelHostServices } from "#/host-services";
import { collectionHeaderQuery } from "#/modules/collections/collection-header";
import { CollectionLoadDialog } from "#/modules/collections/collection-load-dialog";
import {
	collectionFieldFrom,
	type FieldDraft,
	fieldDraftFrom,
	fieldTypeChoices,
	hasDefaultValue,
	newFieldDraft,
} from "#/modules/collections/field-drafts";

type SaveRequest =
	| { readonly action: "create"; readonly request: ContractRequest<"collections", "create"> }
	| { readonly action: "update"; readonly request: ContractRequest<"collections", "update"> };

const saveCollection = createRyotHostMutation<
	{
		readonly save: SaveRequest;
		readonly invalidate: () => Promise<void>;
		readonly onSaved: (collectionId: EntityId) => void;
	},
	void,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, hostServices }) =>
		Effect.gen(function* () {
			const api = hostServices.runtime.runSync(CollectionsApi);
			const saved = yield* input.save.action === "create"
				? api.create(hostServices.scope, input.save.request)
				: api.update(hostServices.scope, input.save.request);
			yield* Effect.promise(input.invalidate).pipe(Effect.ignoreCause);
			input.onSaved(saved.id);
		}),
	{ hostServices: KernelHostServices },
);

const deleteCollection = createRyotHostMutation<
	{
		readonly onDeleted: () => void;
		readonly collectionId: EntityId;
		readonly invalidate: () => Promise<void>;
	},
	void,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, hostServices }) =>
		hostServices.runtime
			.runSync(CollectionsApi)
			.delete(hostServices.scope, { payload: { collectionId: input.collectionId } })
			.pipe(
				Effect.andThen(() => Effect.promise(input.invalidate).pipe(Effect.ignoreCause)),
				Effect.andThen(() => Effect.sync(input.onDeleted)),
			),
	{ hostServices: KernelHostServices },
);

const defaultInputTypes: Partial<Record<FieldDraft["type"], string>> = {
	date: "date",
	number: "number",
};

const selectIcons = {
	checkIcon: <AppIcon size={16} name="check" />,
	chevronIcon: <AppIcon size={16} name="chevron-down" />,
};

type EditorErrors = {
	readonly name?: Message | undefined;
	readonly general?: Message | undefined;
	readonly fields: Readonly<Record<number, ReadonlyArray<Message>>>;
};

const noErrors: EditorErrors = { fields: {} };

const isBadRequest = Schema.is(CollectionBadRequest);
const isNotFound = Schema.is(CollectionNotFound);

const fieldErrorLabels: Partial<Record<string, Message>> = {
	key: kernelMessage("client.collections.editor.field-error.key"),
	defaultValue: kernelMessage("client.collections.editor.field-error.default-value"),
	label: kernelMessage("client.collections.editor.field-error.label", {
		max: collectionFieldLimits.labelLength,
	}),
	choices: kernelMessage("client.collections.editor.field-error.choices", {
		max: collectionFieldLimits.choiceLength,
	}),
	description: kernelMessage("client.collections.editor.field-error.description", {
		max: collectionFieldLimits.descriptionLength,
	}),
};

const editorErrors = (error: unknown): EditorErrors => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : undefined;
	if (isNotFound(cause)) {
		return { ...noErrors, general: kernelMessage("client.collections.load.missing") };
	}
	if (!isBadRequest(cause)) {
		return { ...noErrors, general: kernelMessage("client.collections.editor.error.save-failed") };
	}
	const reason = cause.reason;
	if (reason.code === "name-taken") {
		return { ...noErrors, name: kernelMessage("client.collections.editor.error.name-taken") };
	}
	if (reason.code === "name-required") {
		return { ...noErrors, name: kernelMessage("error.entity-editor.name-required") };
	}
	if (reason.code === "collection-stale") {
		return { ...noErrors, general: kernelMessage("client.collections.editor.error.stale") };
	}
	if (reason.code === "invalid-fields" || reason.code === "reserved-field-key") {
		const fields: Record<number, Array<Message>> = {};
		let general: Message | undefined;
		for (const path of reason.paths) {
			const index = Number(path[1]);
			const label = fieldErrorLabels[path[2] ?? ""];
			if (path[0] === "fields" && Number.isInteger(index) && label !== undefined) {
				fields[index] = [...(fields[index] ?? []), label];
			} else {
				general = kernelMessage("client.collections.editor.error.too-many-fields", {
					max: collectionFieldLimits.fields,
				});
			}
		}
		return { fields, general };
	}
	return { ...noErrors, general: kernelMessage("client.collections.editor.error.check-fields") };
};

export function CollectionEditor(props: {
	readonly onClose: () => void;
	readonly onDeleted: () => void;
	readonly initialName?: string | undefined;
	readonly collectionId?: EntityId | undefined;
	readonly onSaved: (collectionId: EntityId) => void;
}) {
	if (props.collectionId === undefined) {
		return <CollectionEditorForm {...props} header={null} initialName={props.initialName ?? ""} />;
	}
	return <ExistingCollectionEditor {...props} collectionId={props.collectionId} />;
}

function ExistingCollectionEditor(props: {
	readonly onClose: () => void;
	readonly onDeleted: () => void;
	readonly collectionId: EntityId;
	readonly onSaved: (collectionId: EntityId) => void;
}) {
	const t = useT();
	const result = useRyotQuery(collectionHeaderQuery, props.collectionId, {
		refreshOnMutation: false,
	});
	if (result.data) {
		return <CollectionEditorForm {...props} initialName="" header={result.data} />;
	}
	return (
		<CollectionLoadDialog
			onClose={props.onClose}
			failed={result.isError}
			onRetry={result.refetch}
			missing={result.data === null}
			title={t(kernelMessage("client.collections.editor.load-title"))}
			closeLabel={t(kernelMessage("client.collections.editor.close"))}
		/>
	);
}

function FieldDraftEditor(props: {
	readonly index: number;
	readonly draft: FieldDraft;
	readonly disabled: boolean;
	readonly onRemove: () => void;
	readonly errors: ReadonlyArray<Message>;
	readonly onChange: (draft: FieldDraft) => void;
}) {
	const t = useT();
	const { draft } = props;
	const update = (change: Partial<FieldDraft>) => props.onChange({ ...draft, ...change });
	const position = props.index + 1;
	const typeChoices = fieldTypeChoices.map((choice) => ({
		value: choice.value,
		label: t(choice.label),
	}));
	return (
		<fieldset
			disabled={props.disabled}
			className="grid min-w-0 gap-3 rounded-lg border border-border p-3"
			aria-label={t(kernelMessage("client.collections.editor.field", { position }))}
		>
			<div className="grid gap-3 sm:grid-cols-2">
				<Field label={t(kernelMessage("client.collections.editor.label"))}>
					{(control) => (
						<TextField
							{...control}
							value={draft.label}
							onChange={(event) => update({ label: event.currentTarget.value })}
						/>
					)}
				</Field>
				<Field label={t(kernelMessage("client.collections.editor.type"))}>
					{(control) => (
						<Select
							{...control}
							{...selectIcons}
							value={draft.type}
							choices={typeChoices}
							label={t(kernelMessage("client.collections.editor.type"))}
							onChange={(value) => {
								const type = fieldTypeChoices.find((choice) => choice.value === value)?.value;
								if (type !== undefined) {
									update({ type, defaultValue: "", storedDefault: undefined });
								}
							}}
						/>
					)}
				</Field>
			</div>
			<Field optional label={t(kernelMessage("client.collections.editor.description"))}>
				{(control) => (
					<TextField
						{...control}
						value={draft.description}
						onChange={(event) => update({ description: event.currentTarget.value })}
					/>
				)}
			</Field>
			{hasCollectionFieldChoices(draft.type) ? (
				<Field
					label={t(kernelMessage("client.collections.editor.choices"))}
					hint={t(kernelMessage("client.collections.editor.choices-hint"))}
				>
					{(control) => (
						<TextArea
							{...control}
							rows={3}
							value={draft.choices}
							onChange={(event) => update({ choices: event.currentTarget.value })}
						/>
					)}
				</Field>
			) : null}
			{hasDefaultValue(draft.type) ? (
				<Field optional label={t(kernelMessage("client.collections.editor.default-value"))}>
					{(control) =>
						draft.type === "boolean" ? (
							<Select
								{...control}
								{...selectIcons}
								value={draft.defaultValue}
								onChange={(defaultValue) => update({ defaultValue })}
								label={t(kernelMessage("client.collections.editor.default-value"))}
								choices={[
									{ value: "", label: t(kernelMessage("common.value.none")) },
									{ value: "true", label: t(kernelMessage("common.value.yes")) },
									{ value: "false", label: t(kernelMessage("common.value.no")) },
								]}
							/>
						) : (
							<TextField
								{...control}
								value={draft.defaultValue}
								type={defaultInputTypes[draft.type] ?? "text"}
								onChange={(event) => update({ defaultValue: event.currentTarget.value })}
							/>
						)
					}
				</Field>
			) : null}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Checkbox
					checked={draft.required}
					label={t(kernelMessage("client.collections.editor.required"))}
					onChange={(event) => update({ required: event.currentTarget.checked })}
				/>
				<Button variant="ghost" onClick={props.onRemove}>
					{t(kernelMessage("client.collections.editor.remove-field", { position }))}
				</Button>
			</div>
			{props.errors.map((error) => (
				<Notice tone="danger" key={error.key}>
					{t(error)}
				</Notice>
			))}
		</fieldset>
	);
}

function CollectionEditorForm(props: {
	readonly initialName: string;
	readonly onClose: () => void;
	readonly onDeleted: () => void;
	readonly onSaved: (collectionId: EntityId) => void;
	readonly header: null | NonNullable<CollectionHeaderResult>;
}) {
	const { header } = props;
	const t = useT();
	const router = useRouter();
	const saveMutation = useRyotMutation(saveCollection);
	const deleteMutation = useRyotMutation(deleteCollection);
	const deleteTrigger = useRef<HTMLButtonElement>(null);
	const [name, setName] = useState(header?.name ?? props.initialName);
	const [description, setDescription] = useState(header?.description ?? "");
	const [drafts, setDrafts] = useState<ReadonlyArray<FieldDraft>>(() =>
		(header?.fields ?? []).map(fieldDraftFrom),
	);
	const [nameRequired, setNameRequired] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const resetMutations = useEffectEvent(() => {
		saveMutation.reset();
		deleteMutation.reset();
	});
	useEffect(() => () => resetMutations(), []);

	let errors = noErrors;
	if (nameRequired) {
		errors = { ...noErrors, name: kernelMessage("error.entity-editor.name-required") };
	} else if (saveMutation.error !== null && !saveMutation.isPending) {
		errors = editorErrors(saveMutation.error);
	}

	const save = () => {
		if (name.trim() === "") {
			setNameRequired(true);
			return;
		}
		setNameRequired(false);
		const fields = drafts.map(collectionFieldFrom);
		const trimmedDescription = description.trim();
		const request: SaveRequest =
			header === null
				? {
						action: "create",
						request: {
							payload: {
								fields,
								name: name.trim(),
								...(trimmedDescription === "" ? {} : { description: trimmedDescription }),
							},
						},
					}
				: {
						action: "update",
						request: {
							payload: {
								fields,
								name: name.trim(),
								collectionId: header.entityId,
								description: trimmedDescription === "" ? null : trimmedDescription,
							},
						},
					};
		saveMutation.mutate({
			save: request,
			onSaved: props.onSaved,
			invalidate: () => router.invalidate(),
		});
	};

	const remove = (collectionId: EntityId) =>
		deleteMutation.mutate({
			collectionId,
			onDeleted: props.onDeleted,
			invalidate: () => router.invalidate(),
		});

	const busy = saveMutation.isPending || deleteMutation.isPending;
	return (
		<Dialog
			size="lg"
			dismissible={!busy}
			onClose={props.onClose}
			closeLabel={t(kernelMessage("client.collections.editor.close"))}
			title={t(
				header === null
					? kernelMessage("client.collections.editor.title-new")
					: kernelMessage("client.collections.editor.title-edit", { name: header.name }),
			)}
			footer={
				<>
					{header === null ? null : (
						<Button
							variant="ghost"
							disabled={busy}
							ref={deleteTrigger}
							className="mr-auto"
							onClick={() => {
								deleteMutation.reset();
								setConfirmingDelete(true);
							}}
						>
							{t(kernelMessage("client.collections.editor.delete"))}
						</Button>
					)}
					<Button disabled={busy} variant="secondary" onClick={props.onClose}>
						{t(kernelMessage("common.action.cancel"))}
					</Button>
					<Button onClick={save} disabled={busy} loading={saveMutation.isPending}>
						{t(
							header === null
								? kernelMessage("client.collections.editor.create")
								: kernelMessage("client.collections.editor.save"),
						)}
					</Button>
				</>
			}
		>
			<fieldset disabled={busy} className="grid min-w-0 gap-4 border-0 p-0">
				<Field
					label={t(kernelMessage("client.collections.editor.name"))}
					error={errors.name === undefined ? undefined : t(errors.name)}
				>
					{(control) => (
						<TextField
							{...control}
							autoFocus
							value={name}
							onChange={(event) => setName(event.currentTarget.value)}
						/>
					)}
				</Field>
				<Field optional label={t(kernelMessage("client.collections.editor.description"))}>
					{(control) => (
						<TextArea
							{...control}
							rows={2}
							value={description}
							onChange={(event) => setDescription(event.currentTarget.value)}
						/>
					)}
				</Field>
				<section
					className="grid gap-3"
					aria-label={t(kernelMessage("client.collections.editor.member-fields"))}
				>
					<div>
						<h3 className="text-sm font-semibold text-text">
							{t(kernelMessage("client.collections.editor.member-fields"))}
						</h3>
						<p className="text-xs text-text-muted">
							{t(kernelMessage("client.collections.editor.member-fields-hint"))}
						</p>
					</div>
					{header !== null && header.fields === null ? (
						<Notice tone="warning">
							{t(kernelMessage("client.collections.editor.unsupported-fields"))}
						</Notice>
					) : null}
					{drafts.map((draft, index) => (
						<FieldDraftEditor
							index={index}
							draft={draft}
							key={draft.id}
							disabled={busy}
							errors={errors.fields[index] ?? []}
							onRemove={() =>
								setDrafts((current) => current.filter((item) => item.id !== draft.id))
							}
							onChange={(next) =>
								setDrafts((current) => current.map((item) => (item.id === next.id ? next : item)))
							}
						/>
					))}
					<Button
						variant="secondary"
						onClick={() => setDrafts((current) => [...current, newFieldDraft()])}
					>
						{t(kernelMessage("client.collections.editor.add-field"))}
					</Button>
				</section>
				{errors.general === undefined ? null : <Notice tone="danger">{t(errors.general)}</Notice>}
			</fieldset>
			{header !== null && confirmingDelete ? (
				<DestructiveConfirmation
					triggerRef={deleteTrigger}
					pending={deleteMutation.isPending}
					onConfirm={() => remove(header.entityId)}
					onClose={() => setConfirmingDelete(false)}
					pendingLabel={t(kernelMessage("common.status.deleting"))}
					actionLabel={t(kernelMessage("client.collections.editor.delete"))}
					detail={t(kernelMessage("client.collections.editor.delete-detail"))}
					title={t(kernelMessage("client.collections.editor.delete-title", { name: header.name }))}
					errorMessage={
						deleteMutation.error !== null && !deleteMutation.isPending
							? t(kernelMessage("client.collections.editor.delete-failed"))
							: undefined
					}
				/>
			) : null}
		</Dialog>
	);
}
