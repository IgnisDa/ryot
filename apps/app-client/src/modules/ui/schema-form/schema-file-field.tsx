import clsx from "clsx";
import { type ReactNode, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { FormMessage } from "@/modules/ui/form";

import { FileDropZone } from "./file-drop-zone";
import {
	allowedFileExtensionsLabel,
	formatFileSize,
	isAllowedUploadFileName,
	type SchemaFileCandidate,
	type SchemaFilePicker,
	type SchemaFileUpload,
	UNREADABLE_FILE_MESSAGE,
	unsupportedFileExtensionMessage,
} from "./file-upload";

type SchemaFileState =
	| { readonly status: "empty" }
	| { readonly status: "failed"; readonly message: string }
	| { readonly status: "uploading"; readonly name: string; readonly size: number }
	| { readonly status: "uploaded"; readonly name: string; readonly size: number };

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

const attachedFileDetail = (file: AttachedFile) => {
	if (file.size === undefined) {
		return "Ready to import";
	}
	const size = formatFileSize(file.size);
	return file.uploading ? `Uploading · ${size}` : `${size} · Ready to import`;
};

function SchemaFileRow(props: {
	readonly name: string;
	readonly detail: string;
	readonly trailing: ReactNode;
}) {
	return (
		<View className="flex-row items-center gap-2 rounded-lg border border-border bg-raised px-3 py-2.5">
			<AppIcon size={16} name="file-text" className="shrink-0 text-text-muted" />
			<View className="min-w-0 flex-1">
				<Text numberOfLines={1} className="font-ui-medium text-sm text-text">
					{props.name}
				</Text>
				<Text className="font-ui text-xs text-text-subtle">{props.detail}</Text>
			</View>
			{props.trailing}
		</View>
	);
}

export function SchemaFileField(props: {
	readonly label: string;
	readonly value: string | undefined;
	readonly pickFile: SchemaFilePicker;
	readonly uploadFile: SchemaFileUpload;
	readonly allowedFileExtensions: readonly string[];
	readonly onChange: (token: string | undefined) => void;
}) {
	const attempt = useRef(0);
	const [state, setState] = useState<SchemaFileState>({ status: "empty" });
	const extensionsLabel = allowedFileExtensionsLabel(props.allowedFileExtensions);

	const fail = (message: string) => {
		attempt.current = attempt.current + 1;
		setState({ message, status: "failed" });
		props.onChange(undefined);
	};

	const selectFile = async (file: SchemaFileCandidate) => {
		if (!isAllowedUploadFileName(file.name, props.allowedFileExtensions)) {
			fail(unsupportedFileExtensionMessage(props.allowedFileExtensions));
			return;
		}
		const token = ++attempt.current;
		setState({ name: file.name, size: file.size, status: "uploading" });
		props.onChange(undefined);
		const bytes = await file.readBytes().catch(() => undefined);
		if (token !== attempt.current) {
			return;
		}
		if (bytes === undefined) {
			fail(UNREADABLE_FILE_MESSAGE);
			return;
		}
		const outcome = await props.uploadFile({
			bytes,
			fileName: file.name,
			contentType: file.contentType,
		});
		if (token !== attempt.current) {
			return;
		}
		if (outcome.kind === "failed") {
			fail(outcome.message);
			return;
		}
		setState({ name: file.name, size: file.size, status: "uploaded" });
		props.onChange(outcome.token);
	};

	const chooseFile = async () => {
		const outcome = await props.pickFile({
			allowedFileExtensions: props.allowedFileExtensions,
		});
		if (outcome.kind === "picked") {
			await selectFile(outcome.file);
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
			<View className="gap-1.5">
				{attached === undefined ? (
					<Pressable
						accessibilityRole="button"
						onPress={() => void chooseFile()}
						accessibilityLabel={`Choose a file for ${props.label}`}
						accessibilityHint={`Accepts ${extensionsLabel} files. You can also drop a file here.`}
						className={clsx(
							"items-center gap-1 rounded-lg border border-border-strong border-dashed px-3 py-4",
							state.status === "failed" && "border-danger",
						)}
					>
						<AppIcon size={18} name="upload" className="text-text-subtle" />
						<Text className="font-ui-medium text-sm text-text">Choose a file</Text>
						<Text className="font-ui text-xs text-text-subtle">{`Accepts ${extensionsLabel}`}</Text>
					</Pressable>
				) : (
					<SchemaFileRow
						name={attached.name}
						detail={attachedFileDetail(attached)}
						trailing={
							attached.uploading ? (
								<ActivityIndicator
									size="small"
									accessibilityState={{ busy: true }}
									accessibilityLabel={`Uploading ${props.label}`}
								/>
							) : (
								<Pressable
									onPress={removeFile}
									accessibilityRole="button"
									accessibilityLabel={`Remove ${props.label} file`}
								>
									<AppIcon size={16} name="x" className="text-text-muted" />
								</Pressable>
							)
						}
					/>
				)}
				{state.status === "failed" ? <FormMessage>{state.message}</FormMessage> : null}
			</View>
		</FileDropZone>
	);
}
