import clsx from "clsx";
import { useEffect, useState } from "react";

import { deriveImageTint, getImageTintGradientStops, quantizeImageTintPixels } from "./image-tint";

const MAX_DIMENSION = 64;

const loadImageTint = (image: HTMLImageElement) => {
	const { naturalWidth: width, naturalHeight: height } = image;
	if (width === 0 || height === 0) {
		return undefined;
	}
	const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
	const canvas = image.ownerDocument.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	try {
		const context = canvas.getContext("2d");
		if (context === null) {
			return undefined;
		}
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		const tint = deriveImageTint(quantizeImageTintPixels(data));
		return tint === undefined ? undefined : getImageTintGradientStops(tint);
	} catch {
		return undefined;
	}
};

export function useImageTint(url: string | undefined) {
	const [tint, setTint] = useState<{
		readonly url: string;
		readonly gradientStops: ReturnType<typeof loadImageTint>;
	}>();

	return {
		gradientStops: tint?.url === url ? tint?.gradientStops : undefined,
		onLoad: (event: React.SyntheticEvent<HTMLImageElement>) => {
			if (url !== undefined) {
				setTint({ url, gradientStops: loadImageTint(event.currentTarget) });
			}
		},
	};
}

const GRADIENT_ANGLE = { vertical: "to bottom", horizontal: "to right" } as const;

export function ImageTintOverlay(props: {
	readonly direction: "vertical" | "horizontal";
	readonly gradientStops?: undefined | readonly [string, string, string];
}) {
	const gradientStops = props.gradientStops;
	const [visible, setVisible] = useState(false);

	if (!gradientStops && visible) {
		setVisible(false);
	}

	useEffect(() => {
		if (!gradientStops) {
			return undefined;
		}
		const frame = requestAnimationFrame(() => setVisible(true));
		return () => cancelAnimationFrame(frame);
	}, [gradientStops]);

	if (!gradientStops) {
		return null;
	}
	const [start, middle, end] = gradientStops;
	const angle = GRADIENT_ANGLE[props.direction];
	return (
		<div
			aria-hidden="true"
			style={{
				backgroundImage: `linear-gradient(${angle}, ${start} 0%, ${middle} 45%, ${end} 100%)`,
			}}
			className={clsx(
				"pointer-events-none absolute inset-0 transition-opacity duration-[180ms] ease-out motion-reduce:transition-none",
				visible ? "opacity-100" : "opacity-0",
			)}
		/>
	);
}
