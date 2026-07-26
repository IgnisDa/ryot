import { useRyotSafeArea } from "@ryot-app/client-sdk/plugin";
import { ImageTintOverlay, useImageTint } from "@ryot-app/client-ui-sdk/tint";

import { useManagedAssetUrl } from "./managed-assets";
import { showBackdropAsset, showPosterAsset, type ShowSummary } from "./summary-state";

const SHOW_ART_HEIGHT = 204;

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
	const offset = useRyotSafeArea();
	const url = useManagedAssetUrl(showBackdropAsset(props.show));
	if (url === undefined) {
		return null;
	}
	const artStop = offset + SHOW_ART_HEIGHT;
	const height = artStop + SCRIM_FADE_HEIGHT;
	return (
		<div
			aria-hidden="true"
			style={{ top: -offset, height }}
			className="pointer-events-none absolute inset-x-0 -mx-4 overflow-hidden md:hidden"
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
			className="pointer-events-none absolute inset-x-0 top-0 -mx-4 hidden h-80 overflow-hidden md:-mx-8 md:-mt-8 md:flex md:h-104"
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
	const offset = useRyotSafeArea();
	const { gradientStops } = useImageTint(useManagedAssetUrl(showPosterAsset(props.show)));
	return (
		<div
			aria-hidden="true"
			style={{ top: -offset, height: TINT_HEIGHT + offset }}
			className="pointer-events-none absolute inset-x-0 -mx-4 overflow-hidden md:-mx-8"
		>
			<ImageTintOverlay direction="vertical" gradientStops={gradientStops} />
		</div>
	);
}
