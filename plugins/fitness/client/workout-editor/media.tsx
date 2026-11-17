import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { ManagedAssetProvider, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, EmptyState, IconButton, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useRef, useState } from "react";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type { WorkoutSetAssetLocator } from "../../shared/workout-set";
import { managedAssetBatch } from "../asset-urls";
import { MediaPreview } from "../media-preview";
import { useFitnessMessages } from "../messages";
import { EditorSheet } from "./editor-sheet";
import { targetMedia, type WorkoutMediaKind, type WorkoutMediaTarget } from "./media-state";

export function WorkoutMediaOverlay(props: {
	readonly label: Text;
	readonly disabled: boolean;
	readonly canUpload: boolean;
	readonly uploading: boolean;
	readonly onClose: () => void;
	readonly draft: WorkoutEditorDraft;
	readonly target: WorkoutMediaTarget;
	readonly onRemove: (kind: WorkoutMediaKind, asset: WorkoutSetAssetLocator) => void;
	readonly onUpload: (kind: WorkoutMediaKind, file: File) => Effect.Effect<void, unknown>;
}) {
	const text = useFitnessMessages();
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
						onFailure: () => setError(text("client.editor-media.upload-failed")),
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
		<EditorSheet
			onClose={props.onClose}
			closeLabel={text("client.editor-media.close")}
			title={text("client.editor-media.title", { label: props.label })}
			footer={
				props.canUpload ? (
					<>
						<Button
							variant="secondary"
							disabled={disabled}
							onClick={() => imageInput.current?.click()}
						>
							<AppIcon size={15} name="image" />
							{text("client.editor-media.add-photo")}
						</Button>
						<Button
							variant="secondary"
							disabled={disabled}
							onClick={() => videoInput.current?.click()}
						>
							<AppIcon size={15} name="play" />
							{text("client.editor-media.add-video")}
						</Button>
					</>
				) : undefined
			}
		>
			<div className="grid gap-4">
				{props.uploading ? (
					<Notice
						tone="info"
						title={text("client.notices.uploading-title")}
						icon={<AppIcon size={16} name="refresh-cw" />}
					>
						{text("client.notices.uploading-body")}
					</Notice>
				) : null}
				{error === undefined ? null : (
					<Notice tone="danger" icon={<AppIcon size={16} name="circle-alert" />}>
						{error}
					</Notice>
				)}
				{assets.length === 0 ? (
					<EmptyState
						icon={<AppIcon size={20} name="image" />}
						title={text("client.editor-media.empty-title")}
						description={text("client.editor-media.empty-description")}
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
										label={text(
											kind === "images" ? "client.media.image-label" : "client.media.video-label",
											{ index: index + 1, label: props.label },
										)}
									/>
									<IconButton
										size="sm"
										tone="filled"
										disabled={disabled}
										className="absolute top-1 right-1"
										onClick={() => props.onRemove(kind, asset)}
										label={text("client.editor-media.remove", {
											index: index + 1,
											kind: kind === "images" ? "image" : "video",
										})}
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
						title={text("client.editor-media.pro-title")}
					>
						{text("client.editor-media.pro-body")}
					</Notice>
				)}
				<p className="text-xs text-text-muted">{text("client.editor-media.limits")}</p>
				{props.canUpload ? (
					<>
						<input
							type="file"
							ref={imageInput}
							className="sr-only"
							disabled={disabled}
							aria-label={text("client.editor-media.upload-image")}
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
							accept="video/mp4,video/webm,video/quicktime"
							aria-label={text("client.editor-media.upload-video")}
							onChange={(event) => {
								upload("videos", event.target.files?.[0]);
								event.target.value = "";
							}}
						/>
					</>
				) : null}
			</div>
		</EditorSheet>
	);
}
