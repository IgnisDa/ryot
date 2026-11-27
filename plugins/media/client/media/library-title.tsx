import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import { useMediaMessages } from "../messages";

export function MediaLibraryTitle(props: {
	readonly name: string;
	readonly className?: string;
	readonly isInMediaLibrary: boolean;
}) {
	const text = useMediaMessages();
	return (
		<span className={clsx(props.className, props.isInMediaLibrary ? "text-warning" : "text-text")}>
			{props.isInMediaLibrary && (
				<span
					role="img"
					className="mr-1"
					title={text("library.in-library")}
					aria-label={text("library.in-library")}
				>
					<AppIcon size={12} name="circle-check" className="inline-block align-baseline" />
				</span>
			)}
			{props.name}
		</span>
	);
}
