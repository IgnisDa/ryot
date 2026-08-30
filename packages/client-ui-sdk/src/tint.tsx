import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { deriveImageTint, getImageTintGradientStops, quantizeImageTintPixels } from "./image-tint";

const MAX_DIMENSION = 64;

const loadImageTint = async (url: string) => {
	if (typeof document === "undefined") {
		return undefined;
	}
	const image = new Image();
	image.src = url;
	image.crossOrigin = "anonymous";
	try {
		await image.decode();
	} catch {
		return undefined;
	}
	const { naturalWidth: width, naturalHeight: height } = image;
	if (width === 0 || height === 0) {
		return undefined;
	}
	const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const context = canvas.getContext("2d");
	if (context === null) {
		return undefined;
	}
	try {
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		return deriveImageTint(quantizeImageTintPixels(data));
	} catch {
		return undefined;
	}
};

export function useImageTint(url: string | undefined) {
	const currentUrl = useRef(url);
	const failedUrl = useRef<string | undefined>(undefined);
	const [gradientStops, setGradientStops] = useState<readonly [string, string, string]>();
	currentUrl.current = url;

	useEffect(() => {
		let active = true;
		failedUrl.current = undefined;
		setGradientStops(undefined);
		if (url) {
			void loadImageTint(url).then((tint) => {
				if (!active || failedUrl.current === url) {
					return undefined;
				}
				setGradientStops(tint ? getImageTintGradientStops(tint) : undefined);
				return undefined;
			});
		}

		return () => {
			active = false;
		};
	}, [url]);

	return {
		gradientStops,
		onImageError: () => {
			if (!url || currentUrl.current !== url) {
				return;
			}
			failedUrl.current = url;
			setGradientStops(undefined);
		},
	};
}

const GRADIENT_ANGLE = { vertical: "to bottom", horizontal: "to right" } as const;

export function ImageTintOverlay(props: {
	readonly direction: "horizontal" | "vertical";
	readonly gradientStops?: readonly [string, string, string] | undefined;
}) {
	const gradientStops = props.gradientStops;
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (!gradientStops) {
			setVisible(false);
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
