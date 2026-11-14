import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { IconButton, Modal, useFollowEnd } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { useAssistantSubmit } from "./composer";
import { ASSISTANT_NAME } from "./presentation";
import { assistantMoodLabels, AssistantSprite } from "./sprite";
import { AssistantStart } from "./start";
import { AssistantConversation, type AssistantFrameParts } from "./thread";

type AssistantPanelView =
	| { readonly kind: "start" }
	| { readonly kind: "conversation"; readonly conversationId: AssistantConversationId };

export const useAssistantPanel = (location: {
	readonly compact: boolean;
	readonly pathname: string;
}) => {
	const [openedOn, setOpenedOn] = useState<null | string>(null);
	const [view, setView] = useState<AssistantPanelView>({ kind: "start" });
	const open = openedOn !== null && (!location.compact || openedOn === location.pathname);
	const show = () => setOpenedOn(location.pathname);
	const start = useAssistantSubmit({
		onSubmitted: (conversationId) => setView({ conversationId, kind: "conversation" }),
	});
	const startNew = () => setView({ kind: "start" });
	return {
		open,
		view,
		start,
		startNew,
		close: () => setOpenedOn(null),
		toggle: () => (open ? setOpenedOn(null) : show()),
		show: (conversationId: AssistantConversationId) => {
			setView({ conversationId, kind: "conversation" });
			show();
		},
		ask: (text: string) => {
			startNew();
			show();
			if (!start.locked) {
				start.setText(text);
				start.send(text);
			}
		},
	};
};

export function AssistantPanel(props: {
	readonly compact: boolean;
	readonly disabled: boolean;
	readonly panel: ReturnType<typeof useAssistantPanel>;
}) {
	const navigate = useNavigate();
	const { panel } = props;
	if (!panel.open) {
		return null;
	}
	const chrome = {
		onClose: panel.close,
		onNew: panel.startNew,
		onHistory: () => {
			panel.close();
			void (panel.view.kind === "conversation"
				? navigate({
						to: "/assistant/$conversationId",
						params: { conversationId: panel.view.conversationId },
					})
				: navigate({ to: "/assistant" }));
		},
	};
	const content =
		panel.view.kind === "start" ? (
			<PanelLayout {...chrome} title="New chat" mood={panel.start.sending ? "working" : "idle"}>
				<AssistantStart submit={panel.start} disabled={props.disabled} />
			</PanelLayout>
		) : (
			<AssistantConversation
				disabled={props.disabled}
				onDeleted={panel.startNew}
				onStartNew={panel.startNew}
				key={panel.view.conversationId}
				conversationId={panel.view.conversationId}
				renderFrame={(parts) => <PanelLayout {...parts} {...chrome} />}
			/>
		);
	if (props.compact) {
		return (
			<Modal
				placement="sheet"
				onClose={panel.close}
				label={ASSISTANT_NAME}
				containerClassName="items-end"
				closeLabel={`Close ${ASSISTANT_NAME}`}
				className="flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-card"
			>
				{content}
			</Modal>
		);
	}
	return (
		<aside
			aria-label={ASSISTANT_NAME}
			className="flex w-100 shrink-0 flex-col border-l border-border bg-surface"
		>
			{content}
		</aside>
	);
}

function PanelLayout(
	props: AssistantFrameParts & {
		readonly onNew: () => void;
		readonly onClose: () => void;
		readonly onHistory: () => void;
	},
) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	useFollowEnd(scrollRef, contentRef, props.followEnd);
	return (
		<>
			<header
				data-sheet-drag-region
				className="flex shrink-0 items-center gap-2.5 border-b border-border py-2 pr-2 pl-3"
			>
				<AssistantSprite className="w-9" mood={props.mood} />
				<div className="grid min-w-0 flex-1">
					<h2 className="truncate text-body font-semibold text-text">{props.title}</h2>
					<span className="truncate text-micro text-text-subtle">
						{ASSISTANT_NAME} · {assistantMoodLabels[props.mood]}
					</span>
				</div>
				{props.actions}
				<IconButton label="New chat" onClick={props.onNew}>
					<AppIcon size={16} name="plus" />
				</IconButton>
				<IconButton label="All conversations" onClick={props.onHistory}>
					<AppIcon size={16} name="history" />
				</IconButton>
				<IconButton onClick={props.onClose} label={`Close ${ASSISTANT_NAME}`}>
					<AppIcon name="x" size={16} />
				</IconButton>
			</header>
			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
				<div ref={contentRef} className="py-4">
					{props.children}
				</div>
			</div>
			{props.dock === undefined ? null : (
				<div className="shrink-0 border-t border-border p-3">{props.dock}</div>
			)}
		</>
	);
}
