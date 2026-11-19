import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import clsx from "clsx";
import * as Effect from "effect/Effect";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { FieldMessage } from "../../text-field";
import { FileDropZone } from "./drop-zone";
import {
	allowedFileExtensionsLabel,
	formatFileSize,
	isAllowedUploadFileName,
	normalizeUploadContentType,
	type SchemaFileCandidate,
	type SchemaFilePicker,
	type SchemaFileUpload,
	unsupportedFileExtensionMessage,
} from "./upload";

export type SchemaFileIcons = {
	readonly file: ReactNode;
	readonly remove: ReactNode;
	readonly upload: ReactNode;
};

type AttachedFile = {
	readonly uploading: boolean;
	readonly name: null | string;
	readonly size: number | undefined;
};

type SchemaFileState =
	| { readonly status: "empty" }
	| { readonly message: Text; readonly status: "failed" }
	| { readonly name: string; readonly size: number; readonly status: "uploaded" }
	| { readonly name: string; readonly size: number; readonly status: "uploading" };

const attachedFile = (
	state: SchemaFileState,
	value: string | undefined,
): undefined | AttachedFile => {
	if (state.status === "uploading" || state.status === "uploaded") {
		return { name: state.name, size: state.size, uploading: state.status === "uploading" };
	}
	if (value === undefined) {
		return undefined;
	}
	return { name: null, size: undefined, uploading: false };
};

const attachedFileDetail = (
	t: (message: Message) => Text,
	formatters: Formatters,
	file: AttachedFile,
	readyLabel: string,
) => {
	if (file.size === undefined) {
		return readyLabel;
	}
	const size = formatFileSize(formatters, file.size);
	return t(
		file.uploading
			? kernelMessage("ui.file-field.uploading-size", { size })
			: kernelMessage("ui.file-field.ready-size", { size, status: readyLabel }),
	);
};

export function SchemaFileField(props: {
	readonly label: Text;
	readonly readyLabel?: string;
	readonly icons: SchemaFileIcons;
	readonly value: string | undefined;
	readonly pickFile: SchemaFilePicker;
	readonly uploadFile: SchemaFileUpload;
	readonly allowedFileExtensions: readonly string[];
	readonly onChange: (token: string | undefined) => void;
}) {
	const t = useT();
	const formatters = useFormatters();
	const attempt = useRef(0);
	const mounted = useRef(true);
	const [state, setState] = useState<SchemaFileState>({ status: "empty" });
	const extensionsLabel = allowedFileExtensionsLabel(formatters, props.allowedFileExtensions);

	useLayoutEffect(
		() => () => {
			mounted.current = false;
			attempt.current = attempt.current + 1;
		},
		[],
	);

	const isCurrent = (token: number) => mounted.current && token === attempt.current;

	const fail = (token: number, message: Text) => {
		if (!isCurrent(token)) {
			return;
		}
		setState({ message, status: "failed" });
		props.onChange(undefined);
	};

	const selectFile = (file: SchemaFileCandidate, token = ++attempt.current) =>
		Effect.gen(function* () {
			if (!isAllowedUploadFileName(file.name, props.allowedFileExtensions)) {
				fail(token, t(unsupportedFileExtensionMessage(formatters, props.allowedFileExtensions)));
				return;
			}
			const contentType = normalizeUploadContentType(file.name, file.contentType);
			if (contentType === undefined) {
				fail(token, t(unsupportedFileExtensionMessage(formatters, props.allowedFileExtensions)));
				return;
			}
			if (!isCurrent(token)) {
				return;
			}
			setState({ name: file.name, size: file.size, status: "uploading" });
			props.onChange(undefined);
			const outcome = yield* Effect.promise(() =>
				props.uploadFile({ contentType, fileName: file.name, source: file.source }),
			);
			if (!isCurrent(token)) {
				return;
			}
			if (outcome.kind === "failed") {
				fail(token, outcome.message);
				return;
			}
			setState({ name: file.name, size: file.size, status: "uploaded" });
			props.onChange(outcome.token);
		});

	const chooseFile = () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const token = ++attempt.current;
				const outcome = yield* Effect.promise(() =>
					props.pickFile({ allowedFileExtensions: props.allowedFileExtensions }),
				);
				if (isCurrent(token) && outcome.kind === "picked") {
					yield* selectFile(outcome.file, token);
				}
			}),
		);

	const removeFile = () => {
		attempt.current = attempt.current + 1;
		setState({ status: "empty" });
		props.onChange(undefined);
	};

	const attached = attachedFile(state, props.value);

	return (
		<FileDropZone onFileDropped={(file) => void Effect.runPromise(selectFile(file))}>
			<div className="flex flex-col gap-1.5">
				{attached === undefined ? (
					<button
						type="button"
						onClick={() => void chooseFile()}
						aria-label={t(kernelMessage("ui.file-field.choose-for", { label: props.label }))}
						title={t(kernelMessage("ui.file-field.drop-hint", { extensions: extensionsLabel }))}
						className={clsx(
							"flex flex-col items-center gap-1 rounded-lg border border-dashed border-border-strong px-3 py-4",
							state.status === "failed" && "border-danger",
						)}
					>
						<span aria-hidden="true" className="text-text-subtle">
							{props.icons.upload}
						</span>
						<span className="text-sm font-medium text-text">
							{t(kernelMessage("ui.file-field.choose"))}
						</span>
						<span className="text-xs text-text-subtle">
							{t(kernelMessage("ui.file-field.accepts", { extensions: extensionsLabel }))}
						</span>
					</button>
				) : (
					<SchemaFileRow
						icon={props.icons.file}
						name={attached.name ?? t(kernelMessage("ui.file-field.attached"))}
						detail={attachedFileDetail(
							t,
							formatters,
							attached,
							props.readyLabel ?? t(kernelMessage("ui.file-field.ready-to-import")),
						)}
						trailing={
							<div className="flex flex-row items-center">
								{attached.uploading ? (
									<span
										role="status"
										aria-busy="true"
										className="h-4 w-4 rounded-pill border-2 border-border-strong border-t-accent"
										aria-label={t(kernelMessage("ui.file-field.uploading", { label: props.label }))}
									/>
								) : null}
								<button
									type="button"
									onClick={removeFile}
									aria-label={t(kernelMessage("ui.file-field.remove", { label: props.label }))}
									className="flex min-h-11 min-w-11 items-center justify-center text-text-muted"
								>
									{props.icons.remove}
								</button>
							</div>
						}
					/>
				)}
				{state.status === "failed" ? <FieldMessage>{state.message}</FieldMessage> : null}
			</div>
		</FileDropZone>
	);
}

function SchemaFileRow(props: {
	readonly name: string;
	readonly detail: string;
	readonly icon: ReactNode;
	readonly trailing: ReactNode;
}) {
	return (
		<div className="flex flex-row items-center gap-2 rounded-lg border border-border bg-raised px-3 py-2.5">
			<span aria-hidden="true" className="shrink-0 text-text-muted">
				{props.icon}
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium text-text">{props.name}</p>
				<p className="text-xs text-text-subtle">{props.detail}</p>
			</div>
			{props.trailing}
		</div>
	);
}
