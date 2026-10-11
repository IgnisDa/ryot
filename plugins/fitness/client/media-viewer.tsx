import { ManagedAssetProvider } from "@ryot-app/plugin-client-sdk/react";

import type { WorkoutSetAssetLocator } from "../shared/workout-set";
import { managedAssetBatch } from "./asset-urls";
import { MediaPreview } from "./media-preview";

export function WorkoutMediaViewer(props: {
	readonly label: string;
	readonly images: readonly WorkoutSetAssetLocator[];
	readonly videos: readonly WorkoutSetAssetLocator[];
}) {
	if (props.images.length === 0 && props.videos.length === 0) {
		return null;
	}
	return (
		<section className="flex flex-col gap-4" aria-label={`${props.label} attachments`}>
			<h2 className="font-display font-semibold text-[22px] text-text">Attachments</h2>
			<ManagedAssetProvider assets={managedAssetBatch([...props.images, ...props.videos])}>
				<ul className="flex flex-col gap-4">
					{props.images.map((asset, index) => (
						<li key={`image:${JSON.stringify(asset)}`}>
							<MediaPreview
								kind="images"
								asset={asset}
								label={`${props.label} image ${index + 1}`}
							/>
						</li>
					))}
					{props.videos.map((asset, index) => (
						<li key={`video:${JSON.stringify(asset)}`}>
							<MediaPreview
								kind="videos"
								asset={asset}
								label={`${props.label} video ${index + 1}`}
							/>
						</li>
					))}
				</ul>
			</ManagedAssetProvider>
		</section>
	);
}
