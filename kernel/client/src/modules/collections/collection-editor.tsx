import {
	collectionFieldLimits,
	hasCollectionFieldChoices,
} from "@ryot-app/contract/modules/collections/fields";
import {
	CollectionBadRequest,
	CollectionNotFound,
} from "@ryot-app/contract/modules/collections/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
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
import {
	collectionHeaderRecipe,
	type CollectionHeaderResult,
} from "@ryot-app/ryotql-recipes/collections";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { useRef, useState } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";
import { CollectionsApi } from "#/api/collections";
import { CollectionLoadDialog } from "#/modules/collections/collection-load-dialog";
import {
	collectionFieldFrom,
	type FieldDraft,
	fieldDraftFrom,
	fieldTypeChoices,
	hasDefaultValue,
	newFieldDraft,
} from "#/modules/collections/field-drafts";

const collectionHeader = createRyotQuery<EntityId, CollectionHeaderResult>(({ input, client }) =>
	client.data.query(collectionHeaderRecipe({ collectionId: input })),
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
	readonly name?: string | undefined;
	readonly general?: string | undefined;
	readonly fields: Readonly<Record<number, ReadonlyArray<string>>>;
};

const noErrors: EditorErrors = { fields: {} };

const isBadRequest = Schema.is(CollectionBadRequest);
const isNotFound = Schema.is(CollectionNotFound);

const fieldErrorLabels: Partial<Record<string, string>> = {
	defaultValue: "The default value doesn't fit this field.",
	key: "This field can't be kept; remove it and add it again.",
	label: `Enter a label of at most ${collectionFieldLimits.labelLength} characters.`,
	description: `Descriptions are at most ${collectionFieldLimits.descriptionLength} characters.`,
	choices: `Enter at least one unique choice per line, each at most ${collectionFieldLimits.choiceLength} characters.`,
};

const editorErrors = (error: unknown): EditorErrors => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : undefined;
	if (isNotFound(cause)) {
		return { ...noErrors, general: "This collection no longer exists." };
	}
	if (!isBadRequest(cause)) {
		return { ...noErrors, general: "The collection could not be saved. Try again." };
	}
	const reason = cause.reason;
	if (reason.code === "name-taken") {
		return { ...noErrors, name: "You already have a collection with this name." };
	}
	if (reason.code === "name-required") {
		return { ...noErrors, name: "Enter a name." };
	}
	if (reason.code === "collection-stale") {
		return { ...noErrors, general: "This collection changed elsewhere. Close and reopen it." };
	}
	if (reason.code === "invalid-fields" || reason.code === "reserved-field-key") {
		const fields: Record<number, Array<string>> = {};
		let general: string | undefined;
		for (const path of reason.paths) {
			const index = Number(path[1]);
			const label = fieldErrorLabels[path[2] ?? ""];
			if (path[0] === "fields" && Number.isInteger(index) && label !== undefined) {
				fields[index] = [...(fields[index] ?? []), label];
			} else {
				general = `Collections can have at most ${collectionFieldLimits.fields} fields.`;
			}
		}
		return { fields, general };
	}
	return { ...noErrors, general: "The collection could not be saved. Check the fields." };
};

function FieldDraftEditor(props: {
	readonly index: number;
	readonly draft: FieldDraft;
	readonly disabled: boolean;
	readonly errors: ReadonlyArray<string>;
	readonly onChange: (draft: FieldDraft) => void;
	readonly onRemove: () => void;
}) {
	const { draft } = props;
	const update = (change: Partial<FieldDraft>) => props.onChange({ ...draft, ...change });
	const position = props.index + 1;
	return (
		<fieldset
			disabled={props.disabled}
			aria-label={`Field ${position}`}
			className="grid min-w-0 gap-3 rounded-lg border border-border p-3"
		>
			<div className="grid gap-3 sm:grid-cols-2">
				<Field label="Label">
					{(control) => (
						<TextField
							{...control}
							value={draft.label}
							onChange={(event) => update({ label: event.currentTarget.value })}
						/>
					)}
				</Field>
				<Field label="Type">
					{(control) => (
						<Select
							{...control}
							{...selectIcons}
							label="Type"
							value={draft.type}
							choices={fieldTypeChoices}
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
			<Field optional label="Description">
				{(control) => (
					<TextField
						{...control}
						value={draft.description}
						onChange={(event) => update({ description: event.currentTarget.value })}
					/>
				)}
			</Field>
			{hasCollectionFieldChoices(draft.type) ? (
				<Field label="Choices" hint="One choice per line">
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
				<Field optional label="Default value">
					{(control) =>
						draft.type === "boolean" ? (
							<Select
								{...control}
								{...selectIcons}
								label="Default value"
								value={draft.defaultValue}
								onChange={(defaultValue) => update({ defaultValue })}
								choices={[
									{ value: "", label: "None" },
									{ label: "Yes", value: "true" },
									{ label: "No", value: "false" },
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
					label="Required"
					checked={draft.required}
					onChange={(event) => update({ required: event.currentTarget.checked })}
				/>
				<Button variant="ghost" onClick={props.onRemove}>
					Remove field {position}
				</Button>
			</div>
			{props.errors.map((error) => (
				<Notice key={error} tone="danger">
					{error}
				</Notice>
			))}
		</fieldset>
	);
}

function CollectionEditorForm(props: {
	readonly header: NonNullable<CollectionHeaderResult> | null;
	readonly initialName: string;
	readonly onClose: () => void;
	readonly onSaved: (collectionId: EntityId) => void;
	readonly onDeleted: () => void;
}) {
	const { header } = props;
	const router = useRouter();
	const { scope, runtime } = useRouteContext({ from: "/_authenticated" });
	const deleteTrigger = useRef<HTMLButtonElement>(null);
	const [name, setName] = useState(header?.name ?? props.initialName);
	const [description, setDescription] = useState(header?.description ?? "");
	const [drafts, setDrafts] = useState<ReadonlyArray<FieldDraft>>(() =>
		(header?.fields ?? []).map(fieldDraftFrom),
	);
	const [errors, setErrors] = useState<EditorErrors>(noErrors);
	const [pending, setPending] = useState<"save" | "delete" | undefined>();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleteFailed, setDeleteFailed] = useState(false);
	const api = runtime.runSync(CollectionsApi);

	const settle = <A,>(
		action: "save" | "delete",
		effect: Effect.Effect<A, unknown>,
		onSuccess: (value: A) => void,
		onFailure: (error: unknown) => void,
	) => {
		setPending(action);
		void runtime.runPromise(
			effect.pipe(
				Effect.tap(() => Effect.tryPromise(() => router.invalidate()).pipe(Effect.ignore)),
				Effect.match({
					onSuccess: (value) => {
						setPending(undefined);
						onSuccess(value);
					},
					onFailure: (error) => {
						setPending(undefined);
						onFailure(error);
					},
				}),
			),
		);
	};

	const save = () => {
		if (name.trim() === "") {
			setErrors({ ...noErrors, name: "Enter a name." });
			return;
		}
		setErrors(noErrors);
		const fields = drafts.map(collectionFieldFrom);
		const trimmedDescription = description.trim();
		const request =
			header === null
				? api.create(scope, {
						payload: {
							fields,
							name: name.trim(),
							...(trimmedDescription === "" ? {} : { description: trimmedDescription }),
						},
					})
				: api.update(scope, {
						payload: {
							fields,
							name: name.trim(),
							collectionId: header.entityId,
							description: trimmedDescription === "" ? null : trimmedDescription,
						},
					});
		settle(
			"save",
			request,
			(saved) => props.onSaved(saved.id),
			(error) => setErrors(editorErrors(error)),
		);
	};

	const remove = (collectionId: EntityId) =>
		settle(
			"delete",
			api.delete(scope, { payload: { collectionId } }),
			() => props.onDeleted(),
			() => setDeleteFailed(true),
		);

	const busy = pending !== undefined;
	return (
		<Dialog
			size="lg"
			dismissible={!busy}
			onClose={props.onClose}
			closeLabel="Close collection editor"
			title={header === null ? "New collection" : `Edit ${header.name}`}
			footer={
				<>
					{header === null ? null : (
						<Button
							variant="ghost"
							disabled={busy}
							ref={deleteTrigger}
							className="mr-auto"
							onClick={() => {
								setDeleteFailed(false);
								setConfirmingDelete(true);
							}}
						>
							Delete collection
						</Button>
					)}
					<Button disabled={busy} variant="secondary" onClick={props.onClose}>
						Cancel
					</Button>
					<Button onClick={save} disabled={busy} loading={pending === "save"}>
						{header === null ? "Create collection" : "Save collection"}
					</Button>
				</>
			}
		>
			<fieldset disabled={busy} className="grid min-w-0 gap-4 border-0 p-0">
				<Field label="Name" error={errors.name}>
					{(control) => (
						<TextField
							{...control}
							autoFocus
							value={name}
							onChange={(event) => setName(event.currentTarget.value)}
						/>
					)}
				</Field>
				<Field optional label="Description">
					{(control) => (
						<TextArea
							{...control}
							rows={2}
							value={description}
							onChange={(event) => setDescription(event.currentTarget.value)}
						/>
					)}
				</Field>
				<section className="grid gap-3" aria-label="Member fields">
					<div>
						<h3 className="text-sm font-semibold text-text">Member fields</h3>
						<p className="text-xs text-text-muted">
							Extra details recorded for each item you add to this collection.
						</p>
					</div>
					{header !== null && header.fields === null ? (
						<Notice tone="warning">
							This collection's existing fields use an unsupported format and will be replaced when
							you save.
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
						Add field
					</Button>
				</section>
				{errors.general === undefined ? null : <Notice tone="danger">{errors.general}</Notice>}
			</fieldset>
			{header !== null && confirmingDelete ? (
				<DestructiveConfirmation
					triggerRef={deleteTrigger}
					pendingLabel="Deleting..."
					pending={pending === "delete"}
					actionLabel="Delete collection"
					title={`Delete ${header.name}?`}
					onConfirm={() => remove(header.entityId)}
					onClose={() => setConfirmingDelete(false)}
					detail="The collection, its memberships, and its history are deleted. The items in it are kept."
					errorMessage={
						deleteFailed ? "The collection could not be deleted. Try again." : undefined
					}
				/>
			) : null}
		</Dialog>
	);
}

export function CollectionEditor(props: {
	readonly collectionId?: EntityId | undefined;
	readonly initialName?: string | undefined;
	readonly onClose: () => void;
	readonly onSaved: (collectionId: EntityId) => void;
	readonly onDeleted: () => void;
}) {
	if (props.collectionId === undefined) {
		return <CollectionEditorForm {...props} header={null} initialName={props.initialName ?? ""} />;
	}
	return <ExistingCollectionEditor {...props} collectionId={props.collectionId} />;
}

function ExistingCollectionEditor(props: {
	readonly collectionId: EntityId;
	readonly onClose: () => void;
	readonly onSaved: (collectionId: EntityId) => void;
	readonly onDeleted: () => void;
}) {
	const result = useRyotQuery(collectionHeader, props.collectionId, { refreshOnMutation: false });
	if (result.data) {
		return <CollectionEditorForm {...props} initialName="" header={result.data} />;
	}
	return (
		<CollectionLoadDialog
			title="Edit collection"
			onClose={props.onClose}
			failed={result.isError}
			onRetry={result.refetch}
			missing={result.data === null}
			closeLabel="Close collection editor"
		/>
	);
}
