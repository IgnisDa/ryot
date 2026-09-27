import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { ManagedAssetProvider, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, Modal, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef, useState } from "react";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type { WorkoutSetAssetLocator } from "../../shared/workout-set";
import { managedAssetBatch, useAssetUrl } from "../asset-urls";
import { editorModalClass } from "./controls";
import { targetMedia, type WorkoutMediaKind, type WorkoutMediaTarget } from "./media-state";

function MediaPreview(props: {
	readonly asset: WorkoutSetAssetLocator;
	readonly kind: WorkoutMediaKind;
	readonly label: string;
}) {
	const url = useAssetUrl(props.asset);
	const video = useRef<HTMLVideoElement>(null);
	const [failed, setFailed] = useState<string>();
	const [expanded, setExpanded] = useState(false);
	useEffect(() => {
		if (url === undefined) {
			return undefined;
		}
		const player = video.current;
		return () => {
			if (player !== null && !player.paused) {
				player.pause();
			}
		};
	}, [url]);
	if (url === undefined) {
		return (
			<StatusMessage tone="pending">
				Loading attachment… If it stays unavailable, reopen this panel to retry.
			</StatusMessage>
		);
	}
	return (
		<>
			{props.kind === "videos" ? (
				<video
					controls
					src={url}
					ref={video}
					playsInline
					preload="metadata"
					aria-label={props.label}
					onLoadedData={() => setFailed(undefined)}
					className="max-h-80 w-full rounded-lg bg-surface-2"
					onError={() =>
						setFailed(
							"This video could not be played. Its codec may not be supported by this device.",
						)
					}
				/>
			) : (
				<Button
					variant="text"
					onClick={() => setExpanded(true)}
					aria-label={`Preview ${props.label}`}
				>
					<img
						src={url}
						alt={props.label}
						onLoad={() => setFailed(undefined)}
						className="h-28 w-28 rounded-lg object-contain"
						onError={() => setFailed("This image could not be loaded.")}
					/>
				</Button>
			)}
			{failed === undefined ? null : <StatusMessage tone="error">{failed}</StatusMessage>}
			{expanded ? (
				<Modal
					className={editorModalClass}
					label={`Preview ${props.label}`}
					closeLabel="Close image preview"
					onClose={() => setExpanded(false)}
				>
					<img src={url} alt={props.label} className="max-h-[75vh] w-full object-contain" />
				</Modal>
			) : null}
		</>
	);
}

export function WorkoutMediaOverlay(props: {
	readonly draft: WorkoutEditorDraft;
	readonly target: WorkoutMediaTarget;
	readonly label: string;
	readonly canUpload: boolean;
	readonly disabled: boolean;
	readonly uploading: boolean;
	readonly onClose: () => void;
	readonly onRemove: (kind: WorkoutMediaKind, asset: WorkoutSetAssetLocator) => void;
	readonly onUpload: (kind: WorkoutMediaKind, file: File) => Effect.Effect<void, unknown>;
}) {
	const schedule = useRyotSchedule();
	const imageInput = useRef<HTMLInputElement>(null);
	const videoInput = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string>();
	const current = targetMedia(props.draft, props.target);
	if (current === undefined) {
		return null;
	}
	const upload = (kind: WorkoutMediaKind, file: File | undefined) => {
		if (file === undefined) {
			return;
		}
		setError(undefined);
		schedule.run(
			props
				.onUpload(kind, file)
				.pipe(
					Effect.match({
						onSuccess: () => undefined,
						onFailure: () =>
							setError(
								"The attachment could not be uploaded or stored. Check the file type, size, and connection, then retry. Completed uploads remain in your draft.",
							),
					}),
					Effect.asVoid,
				),
			() => undefined,
		);
	};
	const disabled = props.disabled || props.uploading;
	const assets = [
		...current.images.map((asset) => ({ asset, kind: "images" as const })),
		...current.videos.map((asset) => ({ asset, kind: "videos" as const })),
	];
	return (
		<Modal
			onClose={props.onClose}
			className={editorModalClass}
			closeLabel="Close attachments"
			label={`Attachments for ${props.label}`}
		>
			<h2>Attachments for {props.label}</h2>
			<p className="text-sm text-text-subtle">
				Attachments are kept with this draft until you save. Upload supported images or MP4, WebM,
				or MOV videos, up to 50 MiB each. Video playback depends on your device’s codec support.
			</p>
			{props.uploading ? (
				<StatusMessage tone="pending">
					Uploading attachment… Wait before saving or leaving.
				</StatusMessage>
			) : null}
			{error === undefined ? null : <StatusMessage tone="error">{error}</StatusMessage>}
			<ManagedAssetProvider assets={managedAssetBatch(assets.map(({ asset }) => asset))}>
				<ul className="flex flex-col gap-4">
					{assets.map(({ kind, asset }, index) => (
						<li
							key={JSON.stringify([asset, kind, index])}
							className="flex flex-col items-start gap-2"
						>
							<MediaPreview
								kind={kind}
								asset={asset}
								label={`${props.label} ${kind === "images" ? "image" : "video"} ${index + 1}`}
							/>
							<Button
								disabled={disabled}
								variant="secondary"
								onClick={() => props.onRemove(kind, asset)}
							>
								Remove {kind === "images" ? "image" : "video"} {index + 1}
							</Button>
						</li>
					))}
				</ul>
			</ManagedAssetProvider>
			{assets.length === 0 ? <p>No attachments yet.</p> : null}
			{props.canUpload ? (
				<div className="flex flex-wrap gap-2">
					<input
						type="file"
						ref={imageInput}
						className="sr-only"
						disabled={disabled}
						aria-label="Upload image"
						accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
						onChange={(event) => {
							upload("images", event.target.files?.[0]);
							event.target.value = "";
						}}
					/>
					<input
						type="file"
						ref={videoInput}
						className="sr-only"
						disabled={disabled}
						aria-label="Upload video"
						accept="video/mp4,video/webm,video/quicktime"
						onChange={(event) => {
							upload("videos", event.target.files?.[0]);
							event.target.value = "";
						}}
					/>
					<Button disabled={disabled} onClick={() => imageInput.current?.click()}>
						Add image
					</Button>
					<Button disabled={disabled} onClick={() => videoInput.current?.click()}>
						Add video
					</Button>
				</div>
			) : (
				<p>
					Adding workout attachments requires Pro. Existing attachments can still be viewed or
					removed.
				</p>
			)}
		</Modal>
	);
}
