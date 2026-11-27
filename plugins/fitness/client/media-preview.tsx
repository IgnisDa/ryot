import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import { Button, Dialog, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef, useState } from "react";

import type { WorkoutSetAssetLocator } from "../shared/workout-set";
import { useFitnessMessages } from "./messages";

export function MediaPreview(props: {
	readonly label: Text;
	readonly kind: "images" | "videos";
	readonly asset: WorkoutSetAssetLocator;
}) {
	const text = useFitnessMessages();
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
		return <StatusMessage tone="pending">{text("client.media.loading")}</StatusMessage>;
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
					onError={() => setFailed(text("client.media.video-failed"))}
				/>
			) : (
				<Button
					variant="ghost"
					onClick={() => setExpanded(true)}
					aria-label={text("client.media.preview", { label: props.label })}
				>
					<img
						src={url}
						alt={props.label}
						onLoad={() => setFailed(undefined)}
						className="h-28 w-28 rounded-lg object-contain"
						onError={() => setFailed(text("client.media.image-failed"))}
					/>
				</Button>
			)}
			{failed === undefined ? null : <StatusMessage tone="error">{failed}</StatusMessage>}
			{expanded ? (
				<Dialog
					size="lg"
					onClose={() => setExpanded(false)}
					closeLabel={text("client.media.preview-close")}
					title={text("client.media.preview", { label: props.label })}
				>
					<img src={url} alt={props.label} className="max-h-[75vh] w-full object-contain" />
				</Dialog>
			) : null}
		</>
	);
}
