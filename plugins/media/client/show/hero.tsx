import { useRyotSafeArea } from "@ryot-app/client-sdk/plugin";
import { SCREEN_BAR_HEIGHT } from "@ryot-app/client-ui-sdk";
import { ImageTintOverlay, useImageTint } from "@ryot-app/client-ui-sdk/tint";

import { useManagedAssetUrl } from "./managed-assets";
import { showBackdropAsset, showPosterAsset, type ShowSummary } from "./summary-state";

export const SHOW_ART_HEIGHT = 204;

const TINT_HEIGHT = 320;

const SCRIM_OPACITY = 0.7;

const SCRIM_MID_STOP = 0.5;

const SCRIM_HOLD_STOP = 0.35;

const SCRIM_TOP_ALPHA = 0.35;

const SCRIM_MID_ALPHA = 0.7;

const SCRIM_FADE_ALPHA = 0.92;

const SCRIM_FADE_HEIGHT = 76;

const scrimColor = (alpha: number) =>
	`color-mix(in srgb, var(--color-bg) ${alpha * 100}%, transparent)`;

export function ShowHero(props: { readonly show: ShowSummary }) {
	const offset = useRyotSafeArea() + SCREEN_BAR_HEIGHT;
	const url = useManagedAssetUrl(showBackdropAsset(props.show));
	if (url === undefined) {
		return null;
	}
	const artStop = offset + SHOW_ART_HEIGHT;
	const height = artStop + SCRIM_FADE_HEIGHT;
	return (
		<div
			style={{ height }}
			aria-hidden="true"
			className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden md:hidden"
		>
			<img alt="" key={url} src={url} className="h-full w-full object-cover" />
			<div
				className="absolute inset-0"
				style={{
					backgroundImage: `linear-gradient(to bottom, ${scrimColor(SCRIM_TOP_ALPHA)} 0%, ${scrimColor(
						SCRIM_MID_ALPHA,
					)} ${SCRIM_MID_STOP * 100}%, ${scrimColor(SCRIM_FADE_ALPHA)} ${
						(artStop / height) * 100
					}%, var(--color-bg) 100%)`,
				}}
			/>
		</div>
	);
}

export function ShowBackdrop(props: { readonly show: ShowSummary }) {
	const url = useManagedAssetUrl(showBackdropAsset(props.show));
	if (url === undefined) {
		return null;
	}
	const scrim = scrimColor(SCRIM_OPACITY);
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-x-0 top-0 hidden h-80 overflow-hidden md:flex md:h-104"
		>
			<img alt="" key={url} src={url} className="h-full w-full object-cover" />
			<div
				className="absolute inset-0"
				style={{
					backgroundImage: `linear-gradient(to bottom, ${scrim} 0%, ${scrim} ${
						SCRIM_HOLD_STOP * 100
					}%, var(--color-bg) 100%)`,
				}}
			/>
		</div>
	);
}

export function ShowTint(props: { readonly show: ShowSummary }) {
	const offset = useRyotSafeArea() + SCREEN_BAR_HEIGHT;
	const { gradientStops } = useImageTint(useManagedAssetUrl(showPosterAsset(props.show)));
	return (
		<div
			aria-hidden="true"
			style={{ height: TINT_HEIGHT + offset }}
			className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden"
		>
			<ImageTintOverlay direction="vertical" gradientStops={gradientStops} />
		</div>
	);
}
