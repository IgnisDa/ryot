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
	const navigate = useNavigate();
	const submit = useAssistantSubmit({
		onSubmitted: (conversationId) =>
			void navigate({ params: { conversationId }, to: "/assistant/$conversationId" }),
	});
	return (
		<AppScreen title="New chat" width="readable" backFallbackHref="/assistant">
			<AssistantStart submit={submit} disabled={props.disabled} />
		</AppScreen>
	);
}

export function AssistantStart(props: {
	readonly disabled: boolean;
	readonly submit: ReturnType<typeof useAssistantSubmit>;
}) {
	const { submit } = props;
	const { catalog } = usePluginCatalog();
	const provider = useRyotQuery(providerQuery, {});
	const ready = provider.data != null;
	return (
		<div className="grid gap-6 pt-4">
			<div className="flex items-center gap-4">
				<AssistantSprite className="w-16" mood={submit.sending ? "working" : "idle"} />
				<div className="grid gap-1.5">
					<h2 className="font-display text-display font-semibold text-balance text-text">
						What should {ASSISTANT_NAME} do?
					</h2>
					<p className="text-text-muted">
						Ask about your data, change it, or build a page. Every change asks you first.
					</p>
				</div>
			</div>
			{provider.isError ? (
				<Notice tone="danger" action={<Button onClick={provider.refetch}>Retry</Button>}>
					Provider settings could not be loaded.
				</Notice>
			) : null}
			{provider.data === null ? (
				<Notice tone="info">
					Connect your provider in <Link to="/settings/assistant">Settings → {ASSISTANT_NAME}</Link>{" "}
					to start chatting.
				</Notice>
			) : null}
			{props.disabled ? (
				<Notice tone="info">
					Demo sessions can chat, but cannot approve changes or save pages.
				</Notice>
			) : null}
			<AssistantComposer
				submit={submit}
				disabled={!ready}
				placeholder={`Message ${ASSISTANT_NAME}`}
				footer={
					provider.data == null ? undefined : (
						<>
							{provider.data.model} ·{" "}
							{provider.data.source === "instance" ? "server default" : "your provider"} ·{" "}
							<Link className="underline" to="/settings/assistant">
								Change
							</Link>
						</>
					)
				}
			/>
			<ul
				aria-label="Suggestions"
				className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2"
			>
				{assistantStarters(catalog).map((starter) => (
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
