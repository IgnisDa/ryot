import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Modal } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ReactNode } from "react";

export function WizardShell(props: {
	readonly title: Text;
	readonly closeLabel: Text;
	readonly stepLabel: Message;
	readonly children: ReactNode;
	readonly onClose: () => void;
}) {
	const t = useT();
	return (
		<Modal
			label={props.title}
			onClose={props.onClose}
			closeLabel={t(kernelMessage("common.action.close"))}
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
						<AppIcon name="x" size={20} />
					</button>
				</div>
				<p className="text-xs text-text-subtle">{t(props.stepLabel)}</p>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex flex-col gap-4 p-4">{props.children}</div>
			</div>
		</Modal>
	);
}
