import clsx from "clsx";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

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

type SchemaFileState =
	| { readonly status: "empty" }
	| { readonly status: "failed"; readonly message: string }
	| { readonly status: "uploaded"; readonly name: string; readonly size: number }
	| { readonly status: "uploading"; readonly name: string; readonly size: number };

export type SchemaFileIcons = {
	readonly file: ReactNode;
	readonly remove: ReactNode;
	readonly upload: ReactNode;
};

const ATTACHED_FILE_FALLBACK_NAME = "Attached file";

type AttachedFile = {
	readonly name: string;
	readonly uploading: boolean;
	readonly size: number | undefined;
};

const attachedFile = (
	state: SchemaFileState,
	value: string | undefined,
): AttachedFile | undefined => {
	if (state.status === "uploading" || state.status === "uploaded") {
		return { name: state.name, size: state.size, uploading: state.status === "uploading" };
	}
	if (value === undefined) {
		return undefined;
	}
	return { size: undefined, uploading: false, name: ATTACHED_FILE_FALLBACK_NAME };
};

const attachedFileDetail = (file: AttachedFile, readyLabel: string) => {
	if (file.size === undefined) {
		return readyLabel;
	}
	const size = formatFileSize(file.size);
	return file.uploading ? `Uploading · ${size}` : `${size} · ${readyLabel}`;
};

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

export function SchemaFileField(props: {
	readonly label: string;
	readonly readyLabel?: string;
	readonly icons: SchemaFileIcons;
	readonly value: string | undefined;
	readonly pickFile: SchemaFilePicker;
	readonly uploadFile: SchemaFileUpload;
	readonly allowedFileExtensions: readonly string[];
	readonly onChange: (token: string | undefined) => void;
}) {
	const attempt = useRef(0);
	const mounted = useRef(true);
	const [state, setState] = useState<SchemaFileState>({ status: "empty" });
	const extensionsLabel = allowedFileExtensionsLabel(props.allowedFileExtensions);

	useLayoutEffect(
		() => () => {
			mounted.current = false;
			attempt.current = attempt.current + 1;
		},
		[],
	);

	const isCurrent = (token: number) => mounted.current && token === attempt.current;

	const fail = (token: number, message: string) => {
		if (!isCurrent(token)) {
			return;
		}
		setState({ message, status: "failed" });
		props.onChange(undefined);
	};

	const selectFile = async (file: SchemaFileCandidate, token = ++attempt.current) => {
		if (!isAllowedUploadFileName(file.name, props.allowedFileExtensions)) {
			fail(token, unsupportedFileExtensionMessage(props.allowedFileExtensions));
			return;
		}
		const contentType = normalizeUploadContentType(file.name, file.contentType);
		if (contentType === undefined) {
			fail(token, unsupportedFileExtensionMessage(props.allowedFileExtensions));
			return;
		}
		if (!isCurrent(token)) {
			return;
		}
		setState({ name: file.name, size: file.size, status: "uploading" });
		props.onChange(undefined);
		const outcome = await props.uploadFile({
			contentType,
			fileName: file.name,
			source: file.source,
		});
		if (!isCurrent(token)) {
			return;
		}
		if (outcome.kind === "failed") {
			fail(token, outcome.message);
			return;
		}
		setState({ name: file.name, size: file.size, status: "uploaded" });
		props.onChange(outcome.token);
	};

	const chooseFile = async () => {
		const token = ++attempt.current;
		const outcome = await props.pickFile({ allowedFileExtensions: props.allowedFileExtensions });
		if (isCurrent(token) && outcome.kind === "picked") {
			await selectFile(outcome.file, token);
		}
	};

	const removeFile = () => {
		attempt.current = attempt.current + 1;
		setState({ status: "empty" });
		props.onChange(undefined);
	};

	const attached = attachedFile(state, props.value);

	return (
		<FileDropZone onFileDropped={(file) => void selectFile(file)}>
			<div className="flex flex-col gap-1.5">
				{attached === undefined ? (
					<button
						type="button"
						onClick={() => void chooseFile()}
						aria-label={`Choose a file for ${props.label}`}
						title={`Accepts ${extensionsLabel} files. You can also drop a file here.`}
						className={clsx(
							"flex flex-col items-center gap-1 rounded-lg border border-dashed border-border-strong px-3 py-4",
							state.status === "failed" && "border-danger",
						)}
					>
						<span aria-hidden="true" className="text-text-subtle">
							{props.icons.upload}
						</span>
						<span className="text-sm font-medium text-text">Choose a file</span>
						<span className="text-xs text-text-subtle">{`Accepts ${extensionsLabel}`}</span>
					</button>
				) : (
					<SchemaFileRow
						name={attached.name}
						icon={props.icons.file}
						detail={attachedFileDetail(attached, props.readyLabel ?? "Ready to import")}
						trailing={
							<div className="flex flex-row items-center">
								{attached.uploading ? (
									<span
										role="status"
										aria-busy="true"
										aria-label={`Uploading ${props.label}`}
										className="h-4 w-4 rounded-pill border-2 border-border-strong border-t-accent"
									/>
								) : null}
								<button
									type="button"
									onClick={removeFile}
									aria-label={`Remove ${props.label} file`}
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
