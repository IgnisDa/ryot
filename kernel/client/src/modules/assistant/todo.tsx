import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { AssistantTranscriptEntry } from "@ryot-app/ryotql-recipes/assistant";
import clsx from "clsx";

const marks = {
	completed: { icon: "check", tone: "text-success" },
	pending: { icon: "square", tone: "text-text-subtle" },
	in_progress: { icon: "arrow-right", tone: "text-accent-text" },
} as const;

export function AssistantTodo(props: {
	readonly items: Extract<AssistantTranscriptEntry, { readonly kind: "todo" }>["items"];
}) {
	const t = useT();
	return (
		<ul
			aria-label={t(kernelMessage("client.assistant.todo.label"))}
			className="grid gap-1.5 rounded-lg border border-border-card bg-surface px-3 py-2"
		>
			{props.items.map((item) => (
				<li key={item.content} className="flex items-start gap-2 text-label">
					<AppIcon
						size={14}
						name={marks[item.status].icon}
						className={clsx("mt-0.5", marks[item.status].tone)}
					/>
					<span
						className={clsx(
							item.status === "completed" ? "text-text-subtle line-through" : "text-text",
							item.status === "in_progress" && "font-medium",
						)}
					>
						{item.content}
					</span>
				</li>
			))}
		</ul>
	);
}
