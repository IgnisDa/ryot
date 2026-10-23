import { useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import { Button, Dialog, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef, useState } from "react";

import type { WorkoutSetAssetLocator } from "../shared/workout-set";

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
				<Dialog
					size="lg"
					title={`Preview ${props.label}`}
					closeLabel="Close image preview"
					onClose={() => setExpanded(false)}
				>
					<img src={url} alt={props.label} className="max-h-[75vh] w-full object-contain" />
				</Dialog>
			) : null}
		</>
	);
}
