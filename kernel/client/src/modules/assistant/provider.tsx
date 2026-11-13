import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Card, Field, Notice, TextField } from "@ryot-app/plugin-ui-sdk";
import { Effect } from "effect";
import { useState } from "react";

import { ASSISTANT_NAME } from "./presentation";
import {
	assistantFailureText,
	configureProviderMutation,
	deleteProviderMutation,
	providerQuery,
} from "./service";

export function AssistantProviderForm(props: { readonly disabled: boolean }) {
	const provider = useRyotQuery(providerQuery, {});
	const configure = useRyotMutation(configureProviderMutation);
	const remove = useRyotMutation(deleteProviderMutation);
	const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);
	const [model, setModel] = useState<string | undefined>(undefined);
	const [apiKey, setApiKey] = useState("");
	const [saved, setSaved] = useState(false);
	const currentBaseUrl = baseUrl ?? provider.data?.baseUrl ?? "";
	const currentModel = model ?? provider.data?.model ?? "";
	const pending = configure.isPending || remove.isPending;
	return (
		<Card className="grid gap-4">
			<p>
				Connect an OpenAI-compatible provider to use {ASSISTANT_NAME}. Your provider may charge for
				usage.
			</p>
			{provider.isError ? (
				<Notice tone="danger" action={<Button onClick={provider.refetch}>Retry</Button>}>
					Provider settings could not be loaded.
				</Notice>
			) : null}
			{provider.data !== undefined ? (
				<p>
					{provider.data === null
						? "No provider configured."
						: `Using ${provider.data.model} from ${provider.data.source === "instance" ? "the server default" : "your settings"}.`}
				</p>
			) : null}
			{provider.isPending ? <p role="status">Loading provider…</p> : null}
			{props.disabled ? (
				<Notice tone="info">Provider changes are unavailable in demo sessions.</Notice>
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
					<Field label="Base URL">
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
					<Field label="Model">
						{(control) => (
							<TextField
								{...control}
								required
								value={currentModel}
								onChange={(event) => setModel(event.target.value)}
								placeholder={provider.data?.model ?? "Model name"}
							/>
						)}
					</Field>
					<Field optional label="API key">
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
						Leave the key empty to keep your saved key. Removing your provider restores the server
						default, if available.
					</p>
					<div className="flex gap-2">
						<Button type="submit">{pending ? "Saving…" : "Save provider"}</Button>
						{provider.data?.source === "user" ? (
							<Button
								type="button"
								variant="secondary"
								onClick={() =>
									void Effect.runPromise(remove.mutateEffect(undefined).pipe(Effect.ignore))
								}
							>
								Remove my provider
							</Button>
						) : null}
					</div>
				</fieldset>
			</form>
			{saved ? <p role="status">Provider saved.</p> : null}
			{configure.error !== null || remove.error !== null ? (
				<Notice tone="danger">{assistantFailureText(configure.error ?? remove.error)}</Notice>
			) : null}
		</Card>
	);
}
