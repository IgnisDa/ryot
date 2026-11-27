import type { Text } from "@ryot-app/plugin-client-sdk/react";
import {
	collectManagedAssetLocators,
	ManagedAssetProvider,
} from "@ryot-app/plugin-client-sdk/react";

import type { WorkoutSetAssetLocator } from "../shared/workout-set";
import { MediaPreview } from "./media-preview";
import { useFitnessMessages } from "./messages";

export function WorkoutMediaViewer(props: {
	readonly label: Text;
	readonly images: readonly WorkoutSetAssetLocator[];
	readonly videos: readonly WorkoutSetAssetLocator[];
}) {
	const text = useFitnessMessages();
	if (props.images.length === 0 && props.videos.length === 0) {
		return null;
	}
	return (
		<section
			className="flex flex-col gap-4"
			aria-label={text("client.media.attachments-label", { label: props.label })}
		>
			<h2 className="font-display font-semibold text-[22px] text-text">
				{text("client.media.attachments")}
			</h2>
			<ManagedAssetProvider
				assets={collectManagedAssetLocators([...props.images, ...props.videos])}
			>
				<ul className="flex flex-col gap-4">
					{props.images.map((asset, index) => (
						<li key={`image:${JSON.stringify(asset)}`}>
							<MediaPreview
								kind="images"
								asset={asset}
								label={text("client.media.image-label", { index: index + 1, label: props.label })}
							/>
						</li>
					))}
					{props.videos.map((asset, index) => (
						<li key={`video:${JSON.stringify(asset)}`}>
							<MediaPreview
								kind="videos"
								asset={asset}
								label={text("client.media.video-label", { index: index + 1, label: props.label })}
							/>
						</li>
					))}
				</ul>
			</ManagedAssetProvider>
		</section>
	);
}
