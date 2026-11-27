import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { HotkeyChord } from "@tanstack/react-hotkeys";
import type { ReactElement } from "react";

import { ShortcutKeys } from "./shortcut-hint";

export function Tooltip(props: {
	readonly content?: string;
	readonly shortcut?: HotkeyChord;
	readonly children: ReactElement;
}) {
	return (
		<BaseTooltip.Root>
			<BaseTooltip.Trigger delay={300} render={props.children} />
			<BaseTooltip.Portal>
				<BaseTooltip.Positioner side="top" sideOffset={6} className="z-50">
					<BaseTooltip.Popup
						aria-hidden={props.content === undefined || undefined}
						className="flex max-w-(--available-width) items-center gap-1.5 rounded-sm bg-text px-2 py-1 text-xs font-medium text-bg"
					>
						{props.content}
						{props.shortcut !== undefined && (
							<span
								aria-hidden="true"
								className="inline-flex items-center gap-0.5 font-mono text-micro opacity-70"
							>
								<ShortcutKeys shortcut={props.shortcut} />
							</span>
						)}
					</BaseTooltip.Popup>
				</BaseTooltip.Positioner>
			</BaseTooltip.Portal>
		</BaseTooltip.Root>
	);
}
