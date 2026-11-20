import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotMutation,
	createRyotQuery,
	type RyotSubmission,
	type Text,
	useRyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import {
	ActionForm,
	Button,
	ChipButton,
	Dialog,
	Field,
	MenuButton,
	StatusMessage,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type ComponentProps, useState } from "react";

import { MediaCopyDetails, mediaCopyFields } from "../../shared/media-copy";
import { mediaCopiesRecipe, type MediaCopyRow } from "../../shared/media-copy-recipes";
import { MediaCopyWriteInput, MediaCopyWriteOutput } from "../../shared/media-ownership-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { useMediaCopy, useMediaMessages } from "../messages";
import { mediaCopyBooleanOptions, mediaCopyOption, MediaCopySelectField } from "./copy-fields";
import { MediaCopyVersion } from "./copy-presentation";
import type { MediaCursorPage } from "./cursor-page-state";
import { MediaCursorPages } from "./cursor-pages";

const writeCopy = createRyotMutation<
	RyotSubmission<
		MediaCopyWriteInput | { action: "add"; entityId: string; details: MediaCopyDetails }
	>,
	typeof MediaCopyWriteOutput.Type
>(({ input, client }) =>
	client.operations.invoke({
		slug: "media-copy-write",
		packageId: PLUGIN_PACKAGE_ID,
		output: MediaCopyWriteOutput,
		submittedAt: input.submittedAt,
		inputSchema: MediaCopyWriteInput,
		idempotencyKey: input.submissionId,
		input:
			input.input.action === "add" ? { ...input.input, copyId: input.submissionId } : input.input,
	}),
);

const titleCopiesQuery = createRyotQuery<
	{ entityId: string; after: null | string },
	MediaCursorPage<MediaCopyRow>
>(({ input, client }) =>
	client.data.query(
		mediaCopiesRecipe(client.pluginIdentity(PLUGIN_PACKAGE_ID)),
		{ entityId: input.entityId },
		{ pages: { copies: { limit: 30, after: input.after ?? undefined } } },
	),
);

type CopyAction = { action: "add" } | { row: MediaCopyRow; action: "edit" | "remove" };

type CopyDialog = Pick<
	ComponentProps<typeof Dialog>,
	"size" | "onClose" | "placement" | "closeLabel" | "description" | "dismissible"
>;

export function MediaOwnershipControl(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly entityName: string;
	readonly owned: null | boolean;
}) {
	const { text, display } = useMediaCopy();
	const [open, setOpen] = useState(false);
	const [action, setAction] = useState<CopyAction>();
	const submission = useRyotSubmission(writeCopy);
	const abandon = () => {
		submission.abandon();
		setAction(undefined);
	};
	const start = (next: CopyAction) => {
		submission.abandon();
		setAction(next);
	};
	const [handled, setHandled] = useState(submission.data);
	if (submission.status === "idle" && submission.data !== handled) {
		setHandled(submission.data);
		if (submission.data !== undefined) {
			setAction(undefined);
		}
	}
	const dialog: CopyDialog = {
		size: "lg",
		dismissible: !submission.isPending,
		closeLabel: text("ownership.close"),
		description: display(props.entityName),
		placement: props.compact ? "sheet" : "center",
		onClose: () => {
			abandon();
			setOpen(false);
		},
	};
	const failure = submission.error ? text("ownership.failed") : undefined;
	const save = (details: MediaCopyDetails) => {
		if (submission.status === "retained") {
			const previous = submission.submission?.input;
			if (
				previous &&
				"details" in previous &&
				JSON.stringify(previous.details) === JSON.stringify(details)
			) {
				submission.retry();
				return;
			}
			submission.abandon();
		}
		if (action?.action === "add") {
			submission.submit({ details, action: "add", entityId: props.entityId });
		} else if (action?.action === "edit") {
			submission.submit({ details, action: "update", copyId: action.row.id });
		}
	};
	return (
		<>
			<ChipButton
				onClick={() => setOpen(true)}
				pressed={props.owned === true}
				icon={<AppIcon size={13} name="box" />}
			>
				{text(props.owned === true ? "property.owned" : "ownership.copies")}
			</ChipButton>
			{open && action === undefined && (
				<Dialog
					{...dialog}
					title={text("ownership.copies")}
					footer={
						<Button onClick={() => start({ action: "add" })}>
							<AppIcon size={16} name="plus" />
							{text("ownership.add-copy")}
						</Button>
					}
				>
					<TitleCopies onAction={start} entityId={props.entityId} />
				</Dialog>
			)}
			{open && action?.action === "remove" && (
				<Dialog
					{...dialog}
					size="md"
					title={text("ownership.remove-copy")}
					footer={
						<>
							<Button onClick={abandon} variant="secondary" disabled={submission.isPending}>
								{text("common.action.cancel")}
							</Button>
							<Button
								variant="danger"
								loading={submission.isPending}
								onClick={() =>
									submission.status === "retained"
										? submission.retry()
										: submission.submit({ action: "remove", copyId: action.row.id })
								}
							>
								{text("ownership.remove-copy")}
							</Button>
						</>
					}
				>
					<div className="grid gap-4">
						<p>{text("ownership.remove-confirmation")}</p>
						<div className="rounded-lg border border-border bg-surface-2/35 p-4">
							<MediaCopyVersion details={action.row.properties} />
						</div>
						{failure && <StatusMessage tone="error">{failure}</StatusMessage>}
					</div>
				</Dialog>
			)}
			{open && action !== undefined && action.action !== "remove" && (
				<CopyEditor
					onSave={save}
					dialog={dialog}
					failure={failure}
					onCancel={abandon}
					compact={props.compact}
					pending={submission.isPending}
					initial={action.action === "add" ? {} : action.row.properties}
					title={text(action.action === "add" ? "ownership.add-copy" : "ownership.edit-copy")}
				/>
			)}
		</>
	);
}

function TitleCopies(props: {
	readonly entityId: string;
	readonly onAction: (action: CopyAction) => void;
}) {
	const text = useMediaMessages();
	return (
		<MediaCursorPages
			assets={() => []}
			query={titleCopiesQuery}
			input={{ entityId: props.entityId }}
			getPageInput={(input, after) => ({ ...input, after })}
			copy={{
				empty: text("ownership.empty"),
				loading: { title: text("ownership.loading"), detail: text("ownership.loading-detail") },
				error: () => ({
					title: text("ownership.load-failed"),
					detail: text("ownership.loading-detail"),
				}),
			}}
			renderItems={(items) => (
				<ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-2/35">
					{items.map((row) => (
						<li key={row.id} className="px-4 py-3.5">
							<MediaCopyVersion
								details={row.properties}
								actions={
									row.properties.origin === "integration" ? undefined : (
										<MenuButton
											label={text("ownership.copy-options")}
											items={[
												{
													key: "edit",
													icon: "pencil",
													label: text("ownership.edit-copy"),
													onSelect: () => props.onAction({ row, action: "edit" }),
												},
												{
													key: "remove",
													icon: "trash-2",
													destructive: true,
													label: text("ownership.remove-copy"),
													onSelect: () => props.onAction({ row, action: "remove" }),
												},
											]}
										/>
									)
								}
							/>
						</li>
					))}
				</ul>
			)}
		/>
	);
}

const copySections = [
	{ icon: "box", title: "ownership.copy-details", fields: ["format", "acquiredOn"] },
	{
		icon: "monitor",
		title: "ownership.video-details",
		fields: ["resolution", "scanType", "hdr", "is3d"],
	},
	{
		icon: "headphones",
		title: "ownership.audio-details",
		fields: ["audioCodec", "audioSpatialFormat", "audioChannels"],
	},
] as const satisfies readonly {
	icon: string;
	title: string;
	fields: readonly (keyof MediaCopyDetails)[];
}[];

function CopyEditor(props: {
	readonly title: Text;
	readonly compact: boolean;
	readonly pending: boolean;
	readonly dialog: CopyDialog;
	readonly onCancel: () => void;
	readonly initial: MediaCopyDetails;
	readonly failure: Text | undefined;
	readonly onSave: (details: MediaCopyDetails) => void;
}) {
	const copy = useMediaCopy();
	const { text, local } = copy;
	const [values, setValues] = useState<Record<string, unknown>>({ ...props.initial });
	const onChange = (key: string, value: unknown) => {
		const { [key]: _, ...rest } = values;
		setValues(value === "" ? rest : { ...rest, [key]: value });
	};
	const details = Schema.decodeResult(MediaCopyDetails)(values);
	const submit = () => {
		if (Result.isSuccess(details) && !props.pending) {
			props.onSave(details.success);
		}
	};
	return (
		<Dialog
			{...props.dialog}
			title={props.title}
			footer={
				<>
					<Button variant="secondary" onClick={props.onCancel} disabled={props.pending}>
						{text("common.action.cancel")}
					</Button>
					<Button onClick={submit} loading={props.pending} disabled={Result.isFailure(details)}>
						{text("common.action.save")}
					</Button>
				</>
			}
		>
			<ActionForm onSubmit={submit} label={props.title} className="grid gap-4">
				{copySections.map(({ icon, title, fields }) => (
					<fieldset
						key={title}
						disabled={props.pending}
						className="min-w-0 rounded-lg border border-border px-3 py-3.5"
					>
						<legend className="px-1.5">
							<span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
								<AppIcon size={14} name={icon} />
								{text(title)}
							</span>
						</legend>
						<div className={props.compact ? "grid grid-cols-2 gap-3" : "grid grid-cols-2 gap-4"}>
							{fields.map((key) => {
								const field = mediaCopyFields[key];
								const fieldValue = values[key];
								const inputValue =
									typeof fieldValue === "string" || typeof fieldValue === "boolean"
										? String(fieldValue)
										: "";
								const label = local(field.label);
								if (field.type === "enum" || field.type === "boolean") {
									const choices =
										field.type === "enum"
											? field.choices.values.map((choice) => mediaCopyOption(choice, copy))
											: mediaCopyBooleanOptions(text);
									return (
										<MediaCopySelectField
											key={key}
											label={label}
											value={inputValue}
											choices={[{ value: "", label: text("ownership.unspecified") }, ...choices]}
											onChange={(next) =>
												onChange(
													key,
													field.type === "boolean" && next !== "" ? next === "true" : next,
												)
											}
										/>
									);
								}
								return (
									<Field optional key={key} label={label}>
										{(control) => (
											<TextField
												{...control}
												value={inputValue}
												type={field.type === "date" ? "date" : "text"}
												onChange={(event) => onChange(key, event.currentTarget.value)}
											/>
										)}
									</Field>
								);
							})}
						</div>
					</fieldset>
				))}
				{props.failure && <StatusMessage tone="error">{props.failure}</StatusMessage>}
			</ActionForm>
		</Dialog>
	);
}
