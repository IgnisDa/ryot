import {
	detectPlatform,
	type HotkeyChord,
	useDefaultHotkeysOptions,
} from "@tanstack/react-hotkeys";
import clsx from "clsx";

import { AppIcon } from "./icon";

export function ShortcutHint({
	shortcut,
	className,
}: {
	readonly className?: string;
	readonly shortcut: HotkeyChord;
}) {
	return (
		<kbd
			aria-hidden="true"
			className={clsx(
				"inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-1 rounded border border-border-emphasis px-1.5 font-ui text-micro font-medium whitespace-nowrap text-text-subtle",
				className,
			)}
		>
			<ShortcutKeys shortcut={shortcut} />
		</kbd>
	);
}

export function ShortcutKeys({ shortcut }: { readonly shortcut: HotkeyChord }) {
	const platform = useDefaultHotkeysOptions().hotkey?.platform ?? detectPlatform();

	return shortcut.split("+").map((key) => {
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
	});
}
