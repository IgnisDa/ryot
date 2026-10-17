import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { ManagedAssetProvider, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, Dialog, EmptyState, IconButton, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useRef, useState } from "react";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type { WorkoutSetAssetLocator } from "../../shared/workout-set";
import { managedAssetBatch } from "../asset-urls";
import { MediaPreview } from "../media-preview";
import { targetMedia, type WorkoutMediaKind, type WorkoutMediaTarget } from "./media-state";

export function WorkoutMediaOverlay(props: {
	readonly draft: WorkoutEditorDraft;
	readonly target: WorkoutMediaTarget;
	readonly label: string;
	readonly compact: boolean;
	readonly safeAreaBottom: number;
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
		<Dialog
			onClose={props.onClose}
			closeLabel="Close attachments"
			safeAreaBottom={props.safeAreaBottom}
			title={`Attachments for ${props.label}`}
			closeIcon={<AppIcon name="x" size={18} />}
			placement={props.compact ? "sheet" : "center"}
			footer={
				props.canUpload ? (
					<>
						<Button
							variant="secondary"
							disabled={disabled}
							onClick={() => imageInput.current?.click()}
						>
							<AppIcon size={15} name="image" />
							Add photo
						</Button>
						<Button
							variant="secondary"
							disabled={disabled}
							onClick={() => videoInput.current?.click()}
						>
							<AppIcon size={15} name="play" />
							Add video
						</Button>
					</>
				) : undefined
			}
		>
			<div className="grid gap-4">
				{props.uploading ? (
					<Notice
						tone="info"
						title="Uploading attachment…"
						icon={<AppIcon size={16} name="refresh-cw" />}
					>
						Saving and leaving wait until the upload finishes.
					</Notice>
				) : null}
				{error === undefined ? null : (
					<Notice tone="danger" icon={<AppIcon size={16} name="circle-alert" />}>
						{error}
					</Notice>
				)}
				{assets.length === 0 ? (
					<EmptyState
						title="No attachments yet"
						icon={<AppIcon size={20} name="image" />}
						description="Add form-check videos or photos. They save with the workout."
					/>
				) : (
					<ManagedAssetProvider assets={managedAssetBatch(assets.map(({ asset }) => asset))}>
						<ul className="flex flex-wrap gap-3">
							{assets.map(({ kind, asset }, index) => (
								<li
									key={JSON.stringify([asset, kind, index])}
									className={kind === "videos" ? "relative w-full" : "relative"}
								>
									<MediaPreview
										kind={kind}
										asset={asset}
										label={`${props.label} ${kind === "images" ? "image" : "video"} ${index + 1}`}
									/>
									<IconButton
										size="sm"
										tone="filled"
										disabled={disabled}
										className="absolute top-1 right-1"
										onClick={() => props.onRemove(kind, asset)}
										label={`Remove ${kind === "images" ? "image" : "video"} ${index + 1}`}
									>
										<AppIcon name="x" size={14} />
									</IconButton>
								</li>
							))}
						</ul>
					</ManagedAssetProvider>
				)}
				{props.canUpload ? null : (
					<Notice
						tone="info"
						icon={<AppIcon size={16} name="info" />}
						title="Adding workout attachments requires Pro"
					>
						You can still view and remove existing ones.
					</Notice>
				)}
				<p className="text-xs text-text-muted">
					Images or MP4, WebM and MOV videos up to 50 MiB each. Video playback depends on your
					device.
				</p>
				{props.canUpload ? (
					<>
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
					</>
				) : null}
			</div>
		</Dialog>
	);
}
