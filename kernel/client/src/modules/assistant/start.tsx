import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Notice } from "@ryot-app/plugin-ui-sdk";
import { Link, useNavigate } from "@tanstack/react-router";

import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { AppScreen } from "#/modules/shell/app-screen";

import { AssistantComposer, useAssistantSubmit } from "./composer";
import { ASSISTANT_NAME, assistantStarters } from "./presentation";
import { providerQuery } from "./service";
import { AssistantSprite } from "./sprite";

export function AssistantStartScreen(props: { readonly disabled: boolean }) {
	const t = useT();
	const navigate = useNavigate();
	const submit = useAssistantSubmit({
		onSubmitted: (conversationId) =>
			void navigate({ params: { conversationId }, to: "/assistant/$conversationId" }),
	});
	return (
		<AppScreen
			width="readable"
			backFallbackHref="/assistant"
			title={t(kernelMessage("client.assistant.new-chat"))}
		>
			<AssistantStart submit={submit} disabled={props.disabled} />
		</AppScreen>
	);
}

export function AssistantStart(props: {
	readonly disabled: boolean;
	readonly submit: ReturnType<typeof useAssistantSubmit>;
}) {
	const { submit } = props;
	const t = useT();
	const { catalog } = usePluginCatalog();
	const provider = useRyotQuery(providerQuery, {});
	const ready = provider.data != null;
	return (
		<div className="grid gap-6 pt-4">
			<div className="flex items-center gap-4">
				<AssistantSprite className="w-16" mood={submit.sending ? "working" : "idle"} />
				<div className="grid gap-1.5">
					<h2 className="font-display text-display font-semibold text-balance text-text">
						{t(kernelMessage("client.assistant.start.heading", { name: ASSISTANT_NAME }))}
					</h2>
					<p className="text-text-muted">{t(kernelMessage("client.assistant.start.intro"))}</p>
				</div>
			</div>
			{provider.isError ? (
				<Notice
					tone="danger"
					action={
						<Button onClick={provider.refetch}>{t(kernelMessage("common.action.retry"))}</Button>
					}
				>
					{t(kernelMessage("client.assistant.provider.load-failed"))}
				</Notice>
			) : null}
			{provider.data === null ? (
				<Notice
					tone="info"
					action={
						<Link to="/settings/assistant">
							{t(kernelMessage("client.assistant.settings-link", { name: ASSISTANT_NAME }))}
						</Link>
					}
				>
					{t(kernelMessage("client.assistant.start.connect-provider"))}
				</Notice>
			) : null}
			{props.disabled ? (
				<Notice tone="info">{t(kernelMessage("client.assistant.start.demo-notice"))}</Notice>
			) : null}
			<AssistantComposer
				submit={submit}
				disabled={!ready}
				placeholder={t(kernelMessage("client.assistant.composer.label", { name: ASSISTANT_NAME }))}
				footer={
					provider.data == null ? undefined : (
						<>
							{t(
								kernelMessage("client.assistant.start.provider-summary", {
									model: provider.data.model,
									source: provider.data.source,
								}),
							)}{" "}
							·{" "}
							<Link className="underline" to="/settings/assistant">
								{t(kernelMessage("client.assistant.start.change"))}
							</Link>
						</>
					)
				}
			/>
			<ul
				aria-label={t(kernelMessage("client.assistant.start.suggestions"))}
				className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2"
			>
				{assistantStarters(catalog, t).map((starter) => (
					<li key={`${starter.source}:${starter.text}`}>
						<button
							type="button"
							disabled={!ready || submit.locked}
							onClick={() => submit.setText(starter.text)}
							className="grid h-full w-full gap-1 rounded-lg border border-border-card bg-surface p-3 text-left text-label text-text hover:border-border-emphasis disabled:opacity-60"
						>
							<span className="text-micro font-medium tracking-wide text-text-subtle uppercase">
								{starter.source}
							</span>
							{starter.text}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
