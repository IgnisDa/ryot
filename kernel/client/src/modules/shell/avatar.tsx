import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useState } from "react";

type AvatarProps = {
	readonly name: string;
	readonly className?: string;
	readonly image: null | string;
};

export function Avatar({ name, image, className }: AvatarProps) {
	const trimmed = image?.trim() ?? "";
	const source = trimmed === "" ? null : trimmed;
	const [failedSource, setFailedSource] = useState<null | string>(null);
	return (
		<span
			data-avatar="root"
			className={clsx(
				"inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-text-muted",
				className,
			)}
		>
			{source !== null && source !== failedSource ? (
				<img
					src={source}
					alt={`${name}'s avatar`}
					className="size-full object-cover"
					onError={() => setFailedSource(source)}
				/>
			) : (
				<AppIcon name="user" className="size-4" />
			)}
		</span>
	);
}
