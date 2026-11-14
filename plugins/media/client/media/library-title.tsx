import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

export function MediaLibraryTitle(props: {
	readonly name: string;
	readonly className?: string;
	readonly isInMediaLibrary: boolean;
}) {
	return (
		<span className={clsx(props.className, props.isInMediaLibrary ? "text-warning" : "text-text")}>
			{props.isInMediaLibrary && (
				<span role="img" className="mr-1" title="In your library" aria-label="In your library">
					<AppIcon size={12} name="circle-check" className="inline-block align-baseline" />
				</span>
			)}
			{props.name}
		</span>
	);
}
