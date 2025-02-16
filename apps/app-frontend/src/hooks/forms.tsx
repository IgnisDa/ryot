import {
	Box,
	Button,
	Checkbox,
	FileButton,
	Group,
	Loader,
	NumberInput,
	Paper,
	SegmentedControl,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { Link as LinkIcon, Upload } from "lucide-react";
import type { HTMLInputTypeAttribute } from "react";
import { useState } from "react";
import { useApiClient } from "#/hooks/api";

type TextFieldProps = {
	id?: string;
	label: string;
	required?: boolean;
	disabled?: boolean;
	className?: string;
	placeholder?: string;
	autoComplete?: string;
	type?: HTMLInputTypeAttribute;
};

export function normalizeNumberInputValue(value: number | string) {
	if (typeof value === "number") return value;
	if (value.trim() === "") return value;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

	return value;
}

function TextField(props: TextFieldProps) {
	const field = useFieldContext<string>();

	return (
		<div>
			<TextInput
				id={props.id}
				label={props.label}
				required={props.required}
				disabled={props.disabled}
				value={field.state.value}
				onBlur={field.handleBlur}
				className={props.className}
				type={props.type ?? "text"}
				placeholder={props.placeholder}
				error={!field.state.meta.isValid}
				autoComplete={props.autoComplete}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
			{!field.state.meta.isValid && (
				<Text c="red" size="xs">
					{field.state.meta.errors.map((e) => e?.message).join(", ")}
				</Text>
			)}
		</div>
	);
}

type NumberFieldProps = {
	id?: string;
	label: string;
	required?: boolean;
	disabled?: boolean;
	className?: string;
	placeholder?: string;
};

function NumberField(props: NumberFieldProps) {
	const field = useFieldContext<number | string>();

	return (
		<div>
			<NumberInput
				id={props.id}
				label={props.label}
				required={props.required}
				disabled={props.disabled}
				value={field.state.value}
				onBlur={field.handleBlur}
				className={props.className}
				placeholder={props.placeholder}
				error={!field.state.meta.isValid}
				onChange={(value) =>
					field.handleChange(normalizeNumberInputValue(value))
				}
			/>
			{!field.state.meta.isValid && (
				<Text c="red" size="xs">
					{field.state.meta.errors.map((e) => e?.message).join(", ")}
				</Text>
			)}
		</div>
	);
}

type CheckboxFieldProps = {
	label: string;
	required?: boolean;
	disabled?: boolean;
};

function CheckboxField(props: CheckboxFieldProps) {
	const field = useFieldContext<boolean>();

	return (
		<div>
			<Checkbox
				label={props.label}
				required={props.required}
				disabled={props.disabled}
				onBlur={field.handleBlur}
				checked={field.state.value}
				onChange={(event) => field.handleChange(event.currentTarget.checked)}
			/>
			{!field.state.meta.isValid && (
				<Text c="red" size="xs">
					{field.state.meta.errors.map((e) => e?.message).join(", ")}
				</Text>
			)}
		</div>
	);
}

type ImageFieldValue =
	| { kind: "remote"; url: string }
	| { kind: "s3"; key: string }
	| null
	| undefined;

type ImageFieldProps = {
	label: string;
	required?: boolean;
	disabled?: boolean;
};

function ImageField(props: ImageFieldProps) {
	const apiClient = useApiClient();
	const field = useFieldContext<ImageFieldValue>();
	const [tempUrl, setTempUrl] = useState("");
	const [tempFile, setTempFile] = useState<File | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [uploadMode, setUploadMode] = useState<"url" | "file">("url");
	const [uploadError, setUploadError] = useState<string | null>(null);

	const presignedMutation = apiClient.useMutation("post", "/uploads/presigned");

	const handleFileChange = async (selectedFile: File | null) => {
		setUploadError(null);
		setTempFile(selectedFile);
		if (selectedFile) {
			const reader = new FileReader();
			reader.onloadend = () => {
				setPreviewUrl(reader.result as string);
			};
			reader.readAsDataURL(selectedFile);

			try {
				const presignedResponse = await presignedMutation.mutateAsync({
					body: { contentType: selectedFile.type },
				});

				const { uploadUrl, key } = presignedResponse.data;

				const uploadResponse = await fetch(uploadUrl, {
					method: "PUT",
					body: selectedFile,
					headers: { "Content-Type": selectedFile.type },
				});

				if (!uploadResponse.ok) throw new Error("Failed to upload file to S3");

				field.handleChange({ kind: "s3", key });
			} catch (error) {
				const errorMsg =
					error instanceof Error ? error.message : "Upload failed";
				setUploadError(errorMsg);
				setTempFile(null);
				setPreviewUrl(null);
				field.handleChange(null);
			}
		} else {
			setPreviewUrl(null);
			field.handleChange(null);
		}
	};

	const handleUrlChange = (url: string) => {
		setTempUrl(url);
		if (url.trim()) field.handleChange({ kind: "remote", url: url.trim() });
		else field.handleChange(null);
	};

	const currentPreview = uploadMode === "url" ? tempUrl : previewUrl;

	return (
		<div>
			<Stack gap="md">
				<Group gap="xs">
					<Text size="sm" fw={500}>
						{props.label}
						{props.required && (
							<span style={{ color: "var(--mantine-color-red-6)" }}> *</span>
						)}
					</Text>
				</Group>

				<SegmentedControl
					fullWidth
					value={uploadMode}
					disabled={props.disabled}
					data={[
						{
							value: "url",
							label: (
								<Group gap="xs" justify="center">
									<LinkIcon size={16} strokeWidth={1.5} />
									<Text size="sm">URL</Text>
								</Group>
							),
						},
						{
							value: "file",
							label: (
								<Group gap="xs" justify="center">
									<Upload size={16} strokeWidth={1.5} />
									<Text size="sm">Upload</Text>
								</Group>
							),
						},
					]}
					onChange={(value) => {
						setUploadMode(value as "url" | "file");
						field.handleChange(null);
						setTempFile(null);
						setTempUrl("");
						setPreviewUrl(null);
						setUploadError(null);
					}}
					styles={{
						root: { backgroundColor: "var(--mantine-color-default)" },
						indicator: {
							boxShadow: "var(--mantine-shadow-sm)",
							backgroundColor: "var(--mantine-color-body)",
						},
					}}
				/>

				{uploadMode === "url" && (
					<TextInput
						size="sm"
						value={tempUrl}
						disabled={props.disabled}
						onBlur={field.handleBlur}
						placeholder="https://example.com/image.jpg"
						description="Enter an HTTPS URL to an image"
						onChange={(e) => handleUrlChange(e.currentTarget.value)}
						styles={{
							input: {
								fontSize: "0.8125rem",
								fontFamily: "var(--mantine-font-family-monospace)",
							},
						}}
					/>
				)}

				{uploadMode === "file" && (
					<Stack gap="xs">
						<FileButton
							disabled={props.disabled || presignedMutation.isPending}
							onChange={handleFileChange}
							accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
						>
							{(fileButtonProps) => (
								<Button
									size="sm"
									variant="light"
									disabled={presignedMutation.isPending}
									styles={{ root: { fontWeight: 500 } }}
									leftSection={
										presignedMutation.isPending ? (
											<Loader size={16} />
										) : (
											<Upload size={16} strokeWidth={1.5} />
										)
									}
									{...fileButtonProps}
								>
									{presignedMutation.isPending ? "Uploading..." : "Choose File"}
								</Button>
							)}
						</FileButton>

						{uploadError && (
							<Text c="red" size="xs">
								{uploadError}
							</Text>
						)}

						{tempFile && !presignedMutation.isPending && (
							<Paper
								p="xs"
								radius="sm"
								bg="var(--mantine-color-default)"
								style={{
									border: "1px solid var(--mantine-color-default-border)",
								}}
							>
								<Group gap="xs">
									<Text size="xs" c="dimmed" truncate>
										{tempFile.name}
									</Text>
									<Text size="xs" c="dimmed">
										({(tempFile.size / 1024).toFixed(1)} KB)
									</Text>
								</Group>
							</Paper>
						)}
					</Stack>
				)}

				<Box
					p="md"
					style={{
						borderRadius: 8,
						backgroundColor: "var(--mantine-color-default)",
						border: "1px dashed var(--mantine-color-default-border)",
					}}
				>
					<Stack gap="xs" align="center">
						<Box
							w={120}
							h={120}
							style={{
								display: "flex",
								borderRadius: 8,
								overflow: "hidden",
								alignItems: "center",
								justifyContent: "center",
								backgroundColor: "var(--mantine-color-default-border)",
							}}
						>
							{currentPreview ? (
								<img
									alt="Preview"
									src={currentPreview}
									style={{ width: "100%", height: "100%", objectFit: "cover" }}
								/>
							) : (
								<Text size="xs" c="dimmed">
									Preview
								</Text>
							)}
						</Box>
						{!currentPreview && (
							<Text size="xs" c="dimmed" ta="center">
								Image preview will appear here
							</Text>
						)}
					</Stack>
				</Box>
			</Stack>

			{!field.state.meta.isValid && (
				<Text c="red" size="xs">
					{field.state.meta.errors.map((e) => e?.message).join(", ")}
				</Text>
			)}
		</div>
	);
}

type SubmitButtonProps = {
	label: string;
	variant?: string;
	disabled?: boolean;
	fullWidth?: boolean;
	pendingLabel?: string;
};

function SubmitButton(props: SubmitButtonProps) {
	const form = useFormContext();

	return (
		<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
			{([canSubmit, isSubmitting]) => (
				<Button
					type="submit"
					variant={props.variant}
					fullWidth={props.fullWidth}
					disabled={props.disabled || isSubmitting || !canSubmit}
				>
					{isSubmitting ? (props.pendingLabel ?? props.label) : props.label}
				</Button>
			)}
		</form.Subscribe>
	);
}

export const { fieldContext, useFieldContext, formContext, useFormContext } =
	createFormHookContexts();

export const { useAppForm } = createFormHook({
	formContext,
	fieldContext,
	formComponents: { SubmitButton },
	fieldComponents: { CheckboxField, ImageField, NumberField, TextField },
});
