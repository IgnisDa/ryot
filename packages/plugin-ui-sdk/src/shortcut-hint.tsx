import { detectPlatform, type Hotkey, useDefaultHotkeysOptions } from "@tanstack/react-hotkeys";
import clsx from "clsx";

import { AppIcon } from "./icon";

type ShortcutHintProps = {
	readonly shortcut: Hotkey;
	readonly onAccent?: boolean;
	readonly className?: string;
};

export function ShortcutHint({ shortcut, onAccent, className }: ShortcutHintProps) {
	const platform = useDefaultHotkeysOptions().hotkey?.platform ?? detectPlatform();

	return (
		<kbd
			aria-hidden="true"
			className={clsx(
				"inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-1 rounded border px-1.5 font-ui text-micro font-medium whitespace-nowrap",
				onAccent ? "border-accent-ink text-accent-ink" : "border-border-emphasis text-text-subtle",
				className,
			)}
		>
			{shortcut.split("+").map((key) => {
				if (key === "Mod") {
					return platform === "mac" ? (
						<AppIcon key={key} size={12} name="command" />
					) : (
						<span key={key}>Ctrl</span>
					);
				}
				if (key === "Shift") {
					return <AppIcon key={key} size={12} name="arrow-big-up" />;
				}
				return key;
			})}
		</kbd>
	);
}
