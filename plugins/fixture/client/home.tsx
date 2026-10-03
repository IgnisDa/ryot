import {
	RyotClientError,
	type CleanupManagedAssetOutput,
	type ManagedAssetLocator,
	type TemporaryUploadToken,
} from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import {
	ManagedAssetProvider,
	createRyotMutation,
	createRyotQuery,
	useManagedAssetUrl,
	useRyot,
	useRyotMutation,
	useRyotQuery,
	useRyotTheme,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { useState } from "react";

// oxlint-disable-next-line import/no-unassigned-import
import "./styles.css";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import importedLogo from "./imported-logo.png";
import logo from "./logo.svg";
import { fixtureClientPluginCatalogRecipe } from "./query-recipes";
import { fixtureRoute } from "./targets";

const Greeting = Schema.Struct({ greeting: Schema.String });

const GreetingInput = Schema.Struct({ name: Schema.Union([Schema.String, Schema.Finite]) });

const catalogTones = { error: "error", pending: "pending", success: "success" } as const;

const greetingTones = {
	error: "error",
	idle: "pending",
	pending: "pending",
	success: "success",
} as const;

const fixtureClientPluginCatalogQuery = createRyotQuery(({ client }) =>
	client.data.query(fixtureClientPluginCatalogRecipe()),
);

const greetingMutation = createRyotMutation<typeof GreetingInput.Type, typeof Greeting.Type>(
	({ input, client }) =>
		client.operations.invoke({
			input,
			slug: "greet",
			output: Greeting,
			inputSchema: GreetingInput,
			packageId: PLUGIN_PACKAGE_ID,
		}),
);

const uploadTones = {
	error: "error",
	idle: "pending",
	pending: "pending",
	success: "success",
} as const;

const uploadMutation = createRyotMutation<File, TemporaryUploadToken>(({ input, client }) =>
	client.uploads.uploadTemporary({ source: input, fileName: input.name, contentType: input.type }),
);

const permanentUploadMutation = createRyotMutation<
	{ readonly file: File; readonly onUploaded: (asset: ManagedAssetLocator) => void },
	ManagedAssetLocator
>(({ input, client }) =>
	Effect.gen(function* () {
		const asset = yield* client.uploads.uploadPermanent({
			source: input.file,
			fileName: input.file.name,
			contentType: input.file.type,
		});
		input.onUploaded(asset);
		return asset;
	}),
);

const permanentCleanupMutation = createRyotMutation<
	{
		readonly asset: ManagedAssetLocator;
		readonly onCleaned: (status: CleanupManagedAssetOutput["status"]) => void;
	},
	CleanupManagedAssetOutput
>(({ input, client }) =>
	Effect.gen(function* () {
		const result = yield* client.uploads.cleanup(input.asset);
		input.onCleaned(result.status);
		return result;
	}),
);

function PermanentUploadImage(props: { readonly asset: ManagedAssetLocator }) {
	const url = useManagedAssetUrl(props.asset);
	return url === undefined ? null : <img src={url} alt="Permanent fixture upload" />;
}

export const Home = () => {
	const ryot = useRyot();
	const theme = useRyotTheme();
	const [greetings, setGreetings] = useState(0);
	const greeting = useRyotMutation(greetingMutation);
	const [requested, setRequested] = useState("Ryot");
	const [shouldCrash, setShouldCrash] = useState(false);
	const upload = useRyotMutation(uploadMutation);
	const [uploadName, setUploadName] = useState("");
	const permanentUpload = useRyotMutation(permanentUploadMutation);
	const permanentCleanup = useRyotMutation(permanentCleanupMutation);
	const [permanentUploadName, setPermanentUploadName] = useState("");
	const [permanentAsset, setPermanentAsset] = useState<ManagedAssetLocator>();
	const catalog = useRyotQuery(fixtureClientPluginCatalogQuery);
	const refused =
		greeting.status === "error" &&
		greeting.error instanceof RyotClientError &&
		greeting.error.reason === "operation-failed";
	const installedPackageIds = catalog.data?.map(({ packageId }) => packageId).join(", ") ?? "";
	let catalogMessage = "Client plugin catalog is unavailable.";
	if (catalog.status === "pending") {
		catalogMessage = "Fetching installed client plugins...";
	} else if (catalog.status === "success") {
		catalogMessage = `Installed client plugins: ${installedPackageIds}`;
	}
	let greetingMessage = "";
	if (greeting.status === "pending") {
		greetingMessage = "Requesting a greeting...";
	} else if (greeting.status === "error") {
		greetingMessage = refused
			? "The server refused this greeting."
			: "Greetings are unavailable right now.";
	} else if (greeting.status === "success") {
		greetingMessage = greeting.data?.greeting ?? "";
	}

	let uploadMessage = "Choose a file to upload.";
	if (upload.status === "pending") {
		uploadMessage = `Uploading ${uploadName}...`;
	} else if (upload.status === "error") {
		uploadMessage = "The upload failed.";
	} else if (upload.status === "success") {
		uploadMessage = `Uploaded ${uploadName} as token ${upload.data?.token ?? ""}`;
	}
	let permanentUploadMessage = "Choose a permanent file to upload.";
	if (permanentUpload.status === "pending") {
		permanentUploadMessage = `Uploading ${permanentUploadName}...`;
	} else if (permanentUpload.status === "error") {
		permanentUploadMessage = "The permanent upload failed.";
	} else if (permanentUpload.status === "success") {
		permanentUploadMessage = `Uploaded ${permanentUploadName} permanently.`;
	}
	let permanentCleanupMessage = "";
	if (permanentCleanup.status === "pending") {
		permanentCleanupMessage = "Cleaning up permanent upload...";
	} else if (permanentCleanup.status === "error") {
		permanentCleanupMessage = "Permanent upload cleanup failed.";
	} else if (permanentCleanup.status === "success") {
		permanentCleanupMessage = `Permanent upload cleanup: ${permanentCleanup.data?.status ?? ""}`;
	}

	if (shouldCrash) {
		throw new Error("fixture render failure");
	}

	const requestGreeting = (name: string) => {
		setRequested(name);
		greeting.mutate({ name });
	};

	return (
		<PluginScreenFrame title="Fixture plugin">
			<div className="flex w-full flex-col items-center gap-4 text-text">
				<img alt="" src={logo} className="plugin-logo" />
				<section
					className="flex flex-col items-center gap-3"
					aria-labelledby="fixture-binary-assets-title"
				>
					<h2 id="fixture-binary-assets-title" className="font-display text-lg">
						Binary plugin assets
					</h2>
					<div className="flex items-center gap-2">
						<img
							src={importedLogo}
							className="plugin-logo"
							alt="Fixture plugin binary TSX import logo"
						/>
						<span>Binary TSX import asset</span>
					</div>
					<div className="flex items-center gap-2">
						<div role="img" className="css-logo" aria-label="Fixture plugin binary CSS URL logo" />
						<span>Binary CSS URL asset</span>
					</div>
				</section>
				<p className="text-text-muted">Greeted {greetings} times.</p>
				<Button onClick={() => setGreetings((count) => count + 1)}>Greet</Button>
				<Button variant="secondary" onClick={() => setShouldCrash(true)}>
					Crash during render
				</Button>
				<section
					aria-labelledby="fixture-theme-title"
					className={clsx("w-full max-w-md", "rounded-lg border border-border bg-surface p-4")}
				>
					<h2 id="fixture-theme-title" className="font-display text-lg text-accent-text">
						Theme snapshot
					</h2>
					<p role="status" aria-live="polite" className="text-sm text-text-muted">
						Resolved mode: <strong className="text-accent-text">{theme.resolvedMode}</strong>
					</p>
					<StatusMessage tone="success" className="mt-2">
						Semantic theme tokens synchronized.
					</StatusMessage>
					<div className="mt-3 rounded-md border border-accent bg-accent-soft p-3 text-sm text-text">
						Accent surface with semantic border and primary text
					</div>
				</section>
				<section
					aria-labelledby="fixture-catalog-title"
					className="flex flex-col items-center gap-2"
				>
					<h2 id="fixture-catalog-title" className="font-display text-lg">
						Client plugin catalog
					</h2>
					<StatusMessage id="fixture-catalog-status" tone={catalogTones[catalog.status]}>
						{catalogMessage}
					</StatusMessage>
					<Button
						onClick={catalog.refetch}
						disabled={catalog.isFetching}
						aria-describedby="fixture-catalog-status"
					>
						Refresh catalog
					</Button>
				</section>
				<section
					aria-labelledby="fixture-greeting-title"
					className="flex flex-col items-center gap-2"
				>
					<h2 id="fixture-greeting-title" className="font-display text-lg">
						Server greeting
					</h2>
					<StatusMessage tone={greetingTones[greeting.status]}>{greetingMessage}</StatusMessage>
					{greeting.status === "error" ? (
						<Button variant="secondary" onClick={() => requestGreeting(requested)}>
							Try again
						</Button>
					) : null}
					<Button onClick={() => requestGreeting("Ryot")}>Fetch greeting</Button>
					<Button variant="ghost" onClick={() => requestGreeting("")}>
						Fetch without a name
					</Button>
					<Button variant="ghost" onClick={() => greeting.mutate({ name: Number.NaN })}>
						Fetch with invalid payload
					</Button>
				</section>
				<section
					aria-labelledby="fixture-upload-title"
					className="flex flex-col items-center gap-3"
				>
					<h2 id="fixture-upload-title" className="font-display text-lg">
						Temporary upload
					</h2>
					<StatusMessage tone={uploadTones[upload.status]}>{uploadMessage}</StatusMessage>
					<label className="flex flex-col items-center gap-1">
						<span>Choose a file to upload</span>
						<input
							type="file"
							accept="text/csv"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (file === undefined) {
									return;
								}
								setUploadName(file.name);
								upload.mutate(file);
							}}
						/>
					</label>
				</section>
				<section
					className="flex flex-col items-center gap-3"
					aria-labelledby="fixture-permanent-upload-title"
				>
					<h2 className="font-display text-lg" id="fixture-permanent-upload-title">
						Permanent upload
					</h2>
					<StatusMessage tone={uploadTones[permanentUpload.status]}>
						{permanentUploadMessage}
					</StatusMessage>
					<label className="flex flex-col items-center gap-1">
						<span>Choose a permanent file to upload</span>
						<input
							type="file"
							accept="image/png"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (file === undefined) {
									return;
								}
								setPermanentAsset(undefined);
								setPermanentUploadName(file.name);
								permanentCleanup.reset();
								permanentUpload.mutate({ file, onUploaded: setPermanentAsset });
							}}
						/>
					</label>
					{permanentAsset === undefined ? null : (
						<>
							<ManagedAssetProvider assets={[permanentAsset]}>
								<PermanentUploadImage asset={permanentAsset} />
							</ManagedAssetProvider>
							<Button
								variant="secondary"
								disabled={permanentCleanup.isPending}
								onClick={() =>
									permanentCleanup.mutate({
										asset: permanentAsset,
										onCleaned: (status) => {
											if (status === "deleted") {
												setPermanentAsset(undefined);
											}
										},
									})
								}
							>
								Remove permanent upload
							</Button>
						</>
					)}
					{permanentCleanup.status === "idle" ? null : (
						<StatusMessage tone={uploadTones[permanentCleanup.status]}>
							{permanentCleanupMessage}
						</StatusMessage>
					)}
				</section>
				<PluginLink to={fixtureRoute("/details/item-1", { tab: "stats" })}>
					Item 1 details
				</PluginLink>
				<Button
					variant="secondary"
					onClick={() => ryot.navigation.push(fixtureRoute("/details/item-2"))}
				>
					Open item 2
				</Button>
				<PluginLink to={fixtureRoute("/full-bleed")}>Full-bleed screen</PluginLink>
				<PluginLink to={{ kind: "entity", entityId: "fixture-entity" }}>
					Open fixture entity
				</PluginLink>
			</div>
		</PluginScreenFrame>
	);
};

export default Home;
