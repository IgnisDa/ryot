import { Button, Modal, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef, useState } from "react";

import type { WorkoutSetAssetLocator } from "../shared/workout-set";
import { useAssetUrl } from "./asset-urls";

export function MediaPreview(props: {
	readonly asset: WorkoutSetAssetLocator;
	readonly kind: "images" | "videos";
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
					variant="ghost"
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
					label={`Preview ${props.label}`}
					closeLabel="Close image preview"
					onClose={() => setExpanded(false)}
					className="m-auto flex max-h-[90%] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-5 text-text shadow-card"
				>
					<img src={url} alt={props.label} className="max-h-[75vh] w-full object-contain" />
				</Modal>
			) : null}
		</>
	);
}
