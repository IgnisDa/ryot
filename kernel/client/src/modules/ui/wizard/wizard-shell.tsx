import { Modal } from "@ryot-app/client-ui-sdk";
import type { ReactNode } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";

export function WizardShell(props: {
	readonly title: string;
	readonly stepLabel: string;
	readonly closeLabel: string;
	readonly children: ReactNode;
	readonly onClose: () => void;
}) {
	return (
		<Modal
			label={props.title}
			closeLabel="Close"
			onClose={props.onClose}
			containerClassName="md:items-center md:justify-center md:p-6"
			className="flex w-full flex-1 flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] md:max-h-[85%] md:max-w-2xl md:flex-initial md:rounded-xl md:border md:border-border md:bg-surface md:shadow-card md:pt-0"
		>
			<div className="flex shrink-0 flex-col gap-1 border-b border-border px-4 py-3">
				<div className="flex items-center justify-between gap-3">
					<h2 className="font-display text-xl font-semibold text-text">{props.title}</h2>
					<button
						type="button"
						onClick={props.onClose}
						aria-label={props.closeLabel}
						className="p-1 text-text-muted"
					>
						<AppIcon size={20} name="x" />
					</button>
				</div>
				<p className="text-xs text-text-subtle">{props.stepLabel}</p>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex flex-col gap-4 p-4">{props.children}</div>
			</div>
		</Modal>
	);
}
