import type { RefObject } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";
import type { EdgeIntent } from "#/modules/navigation/edge-intent";

type MobileHeaderProps = {
	readonly title: string;
	readonly isOpen: boolean;
	readonly intent: EdgeIntent;
	readonly drawerId: string;
	readonly onBack: () => void;
	readonly onOpen: () => void;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
};

const control =
	"flex size-11 shrink-0 items-center justify-center rounded-pill text-text hover:bg-surface-2";

export function MobileHeader(props: MobileHeaderProps) {
	return (
		<header
			data-testid="mobile-header"
			className="shrink-0 border-b border-border bg-bg pt-[env(safe-area-inset-top)] md:hidden"
		>
			<div className="flex h-13.5 items-center gap-1.5 px-4">
				{props.intent === "back" ? (
					<button type="button" onClick={props.onBack} aria-label="Go back" className={control}>
						<AppIcon name="chevron-left" size={22} />
					</button>
				) : (
					<button
						type="button"
						className={control}
						ref={props.triggerRef}
						onClick={props.onOpen}
						aria-expanded={props.isOpen}
						aria-label="Open navigation"
						aria-controls={props.drawerId}
					>
						<AppIcon name="menu" size={22} />
					</button>
				)}
				<span className="min-w-0 flex-1 truncate font-ui text-[19px] font-semibold text-text">
					{props.title}
				</span>
			</div>
		</header>
	);
}
