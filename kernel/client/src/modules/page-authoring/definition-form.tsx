import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import { Button, Card, Field, RowGroup, TextArea, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { pickBrowserUploadFile } from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { useState } from "react";

import { SettingsSection } from "#/modules/settings/settings-section";

class PageFileReadError extends Schema.TaggedError<
	PageFileReadError,
	{ readonly brand: unique symbol }
>()("PageFileReadError", { cause: Schema.Unknown }) {}

export function DefinitionForm(props: {
	readonly entry: string;
	readonly queries: string;
	readonly disabled: boolean;
	readonly dependencies: string;
	readonly files: PageDefinition["files"];
	readonly onEntry: (entry: string) => void;
	readonly onQueries: (value: string) => void;
	readonly onError: (message: string) => void;
	readonly onDependencies: (value: string) => void;
	readonly onFiles: (files: PageDefinition["files"]) => void;
}) {
	const [path, setPath] = useState("client/page.tsx");
	const [source, setSource] = useState("");
	const [reading, setReading] = useState(false);
	const add = (content: string) => {
		if (!path.startsWith("client/") && !path.startsWith("shared/")) {
			props.onError("Use a file path under client/ or shared/.");
			return;
		}
		props.onFiles([...props.files.filter((file) => file.path !== path), { path, content }]);
		setSource("");
	};
	const upload = () => {
		setReading(true);
		void Effect.runPromise(
			Effect.gen(function* () {
				const picked = yield* Effect.tryPromise({
					catch: (cause) => new PageFileReadError({ cause }),
					try: () => pickBrowserUploadFile({ allowedFileExtensions: [] }),
				});
				if (picked.kind === "picked") {
					const bytes = yield* Effect.tryPromise({
						try: () => picked.file.source.arrayBuffer(),
						catch: (cause) => new PageFileReadError({ cause }),
					});
					add(Base64.encode(new Uint8Array(bytes)));
				}
			}).pipe(
				Effect.match({
					onSuccess: () => setReading(false),
					onFailure: () => {
						setReading(false);
						props.onError("The file could not be read.");
					},
				}),
			),
		);
	};
	return (
		<fieldset className="grid gap-8" disabled={props.disabled || reading}>
			<SettingsSection
				title="Definition"
				detail="The entry module, plugin dependencies and queries the page may run."
			>
				<Card className="grid gap-4">
					<Field label="Entry file">
						{(control) => (
							<TextField
								{...control}
								required
								value={props.entry}
								className="font-mono"
								onChange={(event) => props.onEntry(event.target.value)}
							/>
						)}
					</Field>
					<Field
						label="Plugin dependencies (JSON)"
						hint="Map each import alias to its plugin package reference and scope. Use {} when there are no dependencies."
					>
						{(control) => (
							<TextArea
								{...control}
								rows={3}
								className="font-mono"
								value={props.dependencies}
								onChange={(event) => props.onDependencies(event.target.value)}
							/>
						)}
					</Field>
					<Field
						label="Declared queries (JSON)"
						hint="A RyotQL document. Page code supplies query arguments and controls."
					>
						{(control) => (
							<TextArea
								{...control}
								rows={5}
								className="font-mono"
								value={props.queries}
								onChange={(event) => props.onQueries(event.target.value)}
							/>
						)}
					</Field>
				</Card>
			</SettingsSection>
			<SettingsSection
				title="Source files and assets"
				detail="Files under client/ or shared/ compiled into the page. Assets are kept as bytes."
			>
				<RowGroup>
					{props.files.length === 0 ? (
						<p className="px-4 py-3 text-sm text-text-muted">No files yet.</p>
					) : (
						<ul className="divide-y divide-border">
							{props.files.map((file) => (
								<li key={file.path} className="flex items-center justify-between gap-2 px-4 py-2">
									<span className="flex min-w-0 items-center gap-2 font-mono text-sm text-text">
										<AppIcon size={15} name="file-text" className="shrink-0 text-text-subtle" />
										<span className="break-all">{file.path}</span>
									</span>
									<Button
										size="sm"
										type="button"
										variant="dangerGhost"
										aria-label={`Remove ${file.path}`}
										onClick={() =>
											props.onFiles(props.files.filter((candidate) => candidate.path !== file.path))
										}
									>
										Remove
									</Button>
								</li>
							))}
						</ul>
					)}
					<div className="grid gap-4 p-4">
						<Field
							label="File path"
							hint="Choose the destination before uploading or pasting. Adding the same path replaces that file."
						>
							{(control) => (
								<TextField
									{...control}
									value={path}
									className="font-mono"
									onChange={(event) => setPath(event.target.value)}
								/>
							)}
						</Field>
						<Field label="Paste source">
							{(control) => (
								<TextArea
									{...control}
									rows={8}
									value={source}
									className="font-mono"
									onChange={(event) => setSource(event.target.value)}
								/>
							)}
						</Field>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => add(Base64.encode(new TextEncoder().encode(source)))}
							>
								Add pasted file
							</Button>
							<Button type="button" onClick={upload} variant="outline">
								<AppIcon size={15} name="upload" />
								Upload file
							</Button>
						</div>
					</div>
				</RowGroup>
			</SettingsSection>
		</fieldset>
	);
}
