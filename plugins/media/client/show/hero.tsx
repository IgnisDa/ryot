import { ImageTintOverlay, useImageTint } from "@ryot-app/client-ui-sdk/tint";

import { useManagedAssetUrl } from "./managed-assets";
import { showBackdropAsset, showPosterAsset, type ShowSummary } from "./summary-state";

export const SHOW_ART_HEIGHT = 280;

export const SHOW_BACKDROP_HEIGHT = 416;

const SCRIM_FADE_HEIGHT = 76;

const SCRIM_HOLD_STOP = 0.35;

const SCRIM_TOP_ALPHA = 0.35;

const SCRIM_MID_ALPHA = 0.7;

const SCRIM_FADE_ALPHA = 0.92;

const SCRIM_WIDE_ALPHA = 0.7;

const scrimColor = (alpha: number) =>
	`color-mix(in srgb, var(--color-bg) ${alpha * 100}%, transparent)`;

const compactScrim = `linear-gradient(to bottom, ${scrimColor(SCRIM_TOP_ALPHA)} 0%, ${scrimColor(
	SCRIM_MID_ALPHA,
)} 50%, ${scrimColor(SCRIM_FADE_ALPHA)} calc(100% - ${SCRIM_FADE_HEIGHT}px), var(--color-bg) 100%)`;

const wideScrim = `linear-gradient(to bottom, ${scrimColor(SCRIM_WIDE_ALPHA)} 0%, ${scrimColor(
	SCRIM_WIDE_ALPHA,
)} ${SCRIM_HOLD_STOP * 100}%, var(--color-bg) 100%)`;

export function ShowHero(props: { readonly compact: boolean; readonly show: ShowSummary }) {
	const url = useManagedAssetUrl(showBackdropAsset(props.show));
	const { gradientStops } = useImageTint(useManagedAssetUrl(showPosterAsset(props.show)));
	return (
		<div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
			<ImageTintOverlay direction="vertical" gradientStops={gradientStops} />
			{url === undefined ? null : (
				<>
					<img alt="" key={url} src={url} className="h-full w-full object-cover" />
					<div
						className="absolute inset-0"
						style={{ backgroundImage: props.compact ? compactScrim : wideScrim }}
					/>
				</>
			)}
		</div>
	);
}
