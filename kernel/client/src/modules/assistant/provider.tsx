import { ASSISTANT_DEFAULT_MODEL_LIMITS } from "@ryot-app/contract/modules/assistant/schemas";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Card, Field, Notice, TextField } from "@ryot-app/plugin-ui-sdk";
import { Effect } from "effect";
import { useState } from "react";

import { ASSISTANT_NAME } from "./presentation";
import {
	assistantFailureMessage,
	configureProviderMutation,
	deleteProviderMutation,
	providerQuery,
} from "./service";

export function AssistantProviderForm(props: { readonly disabled: boolean }) {
	const t = useT();
	const provider = useRyotQuery(providerQuery, {});
	const configure = useRyotMutation(configureProviderMutation);
	const remove = useRyotMutation(deleteProviderMutation);
	const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);
	const [model, setModel] = useState<string | undefined>(undefined);
	const [contextWindow, setContextWindow] = useState<string | undefined>(undefined);
	const [maxOutputTokens, setMaxOutputTokens] = useState<string | undefined>(undefined);
	const [apiKey, setApiKey] = useState("");
	const [saved, setSaved] = useState(false);
	const currentBaseUrl = baseUrl ?? provider.data?.baseUrl ?? "";
	const currentModel = model ?? provider.data?.model ?? "";
	const currentContextWindow =
		contextWindow ??
		String(provider.data?.contextWindow ?? ASSISTANT_DEFAULT_MODEL_LIMITS.contextWindow);
	const currentMaxOutputTokens =
		maxOutputTokens ??
		String(provider.data?.maxOutputTokens ?? ASSISTANT_DEFAULT_MODEL_LIMITS.maxOutputTokens);
	const pending = configure.isPending || remove.isPending;
	return (
		<Card className="grid gap-4">
			<p>{t(kernelMessage("client.assistant.provider.intro", { name: ASSISTANT_NAME }))}</p>
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
			{provider.data !== undefined ? (
				<p>
					{t(
						provider.data === null
							? kernelMessage("client.assistant.provider.none")
							: kernelMessage("client.assistant.provider.using", {
									model: provider.data.model,
									source: provider.data.source,
								}),
					)}
				</p>
			) : null}
			{provider.isPending ? (
				<p role="status">{t(kernelMessage("client.assistant.provider.loading"))}</p>
			) : null}
			{props.disabled ? (
				<Notice tone="info">{t(kernelMessage("client.assistant.provider.demo-disabled"))}</Notice>
			) : null}
			<form
				className="grid gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					setSaved(false);
					void Effect.runPromise(
						configure
							.mutateEffect({
								model: currentModel,
								baseUrl: currentBaseUrl,
								contextWindow: Number(currentContextWindow),
								maxOutputTokens: Number(currentMaxOutputTokens),
								...(apiKey === "" ? {} : { apiKey }),
							})
							.pipe(
								Effect.match({
									onFailure: () => undefined,
									onSuccess: () => {
										setApiKey("");
										setSaved(true);
									},
								}),
							),
					);
				}}
			>
				<fieldset
					className="grid gap-4"
					disabled={props.disabled || pending || provider.isPending || provider.isError}
				>
					<Field label={t(kernelMessage("client.assistant.provider.base-url"))}>
						{(control) => (
							<TextField
								{...control}
								required
								type="url"
								value={currentBaseUrl}
								onChange={(event) => setBaseUrl(event.target.value)}
								placeholder={provider.data?.baseUrl ?? "https://api.example.com/v1"}
							/>
						)}
					</Field>
					<Field label={t(kernelMessage("client.assistant.provider.model"))}>
						{(control) => (
							<TextField
								{...control}
								required
								value={currentModel}
								onChange={(event) => setModel(event.target.value)}
								placeholder={
									provider.data?.model ??
									t(kernelMessage("client.assistant.provider.model-placeholder"))
								}
							/>
						)}
					</Field>
					<Field label={t(kernelMessage("client.assistant.provider.context-window"))}>
						{(control) => (
							<TextField
								{...control}
								min={1}
								step={1}
								required
								type="number"
								value={currentContextWindow}
								onChange={(event) => setContextWindow(event.target.value)}
							/>
						)}
					</Field>
					<Field label={t(kernelMessage("client.assistant.provider.max-output"))}>
						{(control) => (
							<TextField
								{...control}
								min={1}
								step={1}
								required
								type="number"
								value={currentMaxOutputTokens}
								onChange={(event) => setMaxOutputTokens(event.target.value)}
							/>
						)}
					</Field>
					<Field optional label={t(kernelMessage("client.assistant.provider.api-key"))}>
						{(control) => (
							<TextField
								{...control}
								value={apiKey}
								type="password"
								autoComplete="new-password"
								onChange={(event) => setApiKey(event.target.value)}
							/>
						)}
					</Field>
					<p className="text-sm text-text-muted">
						{t(kernelMessage("client.assistant.provider.key-help"))}
					</p>
					<div className="flex gap-2">
						<Button type="submit">
							{t(
								pending
									? kernelMessage("common.status.saving")
									: kernelMessage("client.assistant.provider.save"),
							)}
						</Button>
						{provider.data?.source === "user" ? (
							<Button
								type="button"
								variant="secondary"
								onClick={() =>
									void Effect.runPromise(remove.mutateEffect(undefined).pipe(Effect.ignore))
								}
							>
								{t(kernelMessage("client.assistant.provider.remove"))}
							</Button>
						) : null}
					</div>
				</fieldset>
			</form>
			{saved ? <p role="status">{t(kernelMessage("client.assistant.provider.saved"))}</p> : null}
			{configure.error !== null || remove.error !== null ? (
				<Notice tone="danger">{t(assistantFailureMessage(configure.error ?? remove.error))}</Notice>
			) : null}
		</Card>
	);
}
