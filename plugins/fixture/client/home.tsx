import {
	type ManagedAssetLocator,
	RyotClientError,
	type TemporaryUploadToken,
} from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotMutation,
	createRyotQuery,
	formatError,
	ManagedAssetProvider,
	useFormatters,
	useManagedAssetUrl,
	useMessages,
	useRyot,
	useRyotMutation,
	useRyotQuery,
	useRyotTheme,
	useStampedMessages,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { useState } from "react";

// oxlint-disable-next-line import/no-unassigned-import
import "./styles.css";

import { catalogMessage } from "../shared/messages.generated";
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
	client.data.query(fixtureClientPluginCatalogRecipe, {}),
);

const greetingMutation = createRyotMutation<typeof GreetingInput.Type, typeof Greeting.Type>(
	({ input, client }) =>
		client.operations
			.invoke({
				input,
				slug: "greet",
				output: Greeting,
				inputSchema: GreetingInput,
				packageId: PLUGIN_PACKAGE_ID,
			})
			.pipe(Effect.map(({ output }) => output)),
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

const permanentUploadMutation = createRyotMutation<File, ManagedAssetLocator>(({ input, client }) =>
	client.uploads.uploadPermanent({ source: input, fileName: input.name, contentType: input.type }),
);

function PermanentUploadImage(props: { readonly asset: ManagedAssetLocator }) {
	const url = useManagedAssetUrl(props.asset);
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	return url === undefined ? null : <img src={url} alt={text("home.permanent-upload.image-alt")} />;
}

export const Home = () => {
	const ryot = useRyot();
	const t = useT();
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	const message = useStampedMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	const formatters = useFormatters();
	const theme = useRyotTheme();
	const [greetings, setGreetings] = useState(0);
	const greeting = useRyotMutation(greetingMutation);
	const [requested, setRequested] = useState("Ryot");
	const [shouldCrash, setShouldCrash] = useState(false);
	const upload = useRyotMutation(uploadMutation);
	const [uploadName, setUploadName] = useState("");
	const permanentUpload = useRyotMutation(permanentUploadMutation);
	const [permanentUploadName, setPermanentUploadName] = useState("");
	const catalog = useRyotQuery(fixtureClientPluginCatalogQuery);
	const refused =
		greeting.status === "error" &&
		greeting.error instanceof RyotClientError &&
		greeting.error.reason === "operation-failed";
	const permanentAsset = permanentUpload.status === "success" ? permanentUpload.data : undefined;
	const installedPackageIds = formatters
		.list({ type: "unit", style: "short" })
		.format(catalog.data?.map(({ packageId }) => packageId) ?? []);
	let catalogStatusMessage = text("home.catalog.unavailable");
	if (catalog.status === "pending") {
		catalogStatusMessage = text("home.catalog.loading");
	} else if (catalog.status === "success") {
		catalogStatusMessage = text("home.catalog.installed", { packageIds: installedPackageIds });
	}
	let greetingMessage = "";
	if (greeting.status === "pending") {
		greetingMessage = text("home.greeting.pending");
	} else if (greeting.status === "error") {
		greetingMessage = formatError(
			t,
			greeting.error,
			refused ? text("home.greeting.refused") : text("home.greeting.unavailable"),
		);
	} else if (greeting.status === "success") {
		greetingMessage = greeting.data?.greeting ?? "";
	}

	let uploadMessage = text("home.upload.prompt");
	if (upload.status === "pending") {
		uploadMessage = text("home.upload.pending", { fileName: uploadName });
	} else if (upload.status === "error") {
		uploadMessage = text("home.upload.failed");
	} else if (upload.status === "success") {
		uploadMessage = text("home.upload.succeeded", {
			fileName: uploadName,
			token: upload.data?.token ?? "",
		});
	}
	let permanentUploadMessage = text("home.permanent-upload.prompt");
	if (permanentUpload.status === "pending") {
		permanentUploadMessage = text("home.upload.pending", { fileName: permanentUploadName });
	} else if (permanentUpload.status === "error") {
		permanentUploadMessage = text("home.permanent-upload.failed");
	} else if (permanentUpload.status === "success") {
		permanentUploadMessage = text("home.permanent-upload.succeeded", {
			fileName: permanentUploadName,
		});
	}

	if (shouldCrash) {
		throw new Error("fixture render failure");
	}

	const requestGreeting = (name: string) => {
		setRequested(name);
		greeting.mutate({ name });
	};

	return (
		<PluginScreenFrame title={message("home.title")}>
			<div className="flex w-full flex-col items-center gap-4 text-text">
				<img alt="" src={logo} className="plugin-logo" />
				<section
					className="flex flex-col items-center gap-3"
					aria-labelledby="fixture-binary-assets-title"
				>
					<h2 id="fixture-binary-assets-title" className="font-display text-lg">
						{text("home.binary-assets.title")}
					</h2>
					<div className="flex items-center gap-2">
						<img
							src={importedLogo}
							className="plugin-logo"
							alt={text("home.binary-assets.imported-logo-alt")}
						/>
						<span>{text("home.binary-assets.imported-logo-label")}</span>
					</div>
					<div className="flex items-center gap-2">
						<div
							role="img"
							className="css-logo"
							aria-label={text("home.binary-assets.css-logo-alt")}
						/>
						<span>{text("home.binary-assets.css-logo-label")}</span>
					</div>
				</section>
				<p className="text-text-muted">{text("home.greeted", { count: greetings })}</p>
				<Button onClick={() => setGreetings((count) => count + 1)}>{text("home.greet")}</Button>
				<Button variant="secondary" onClick={() => setShouldCrash(true)}>
					{text("home.crash")}
				</Button>
				<section
					aria-labelledby="fixture-theme-title"
					className={clsx("w-full max-w-md", "rounded-lg border border-border bg-surface p-4")}
				>
					<h2 id="fixture-theme-title" className="font-display text-lg text-accent-text">
						{text("home.theme.title")}
					</h2>
					<p role="status" aria-live="polite" className="text-sm text-text-muted">
						{text("home.theme.resolved-mode")}{" "}
						<strong className="text-accent-text">
							{text("home.theme.mode", { mode: theme.resolvedMode })}
						</strong>
					</p>
					<StatusMessage tone="success" className="mt-2">
						{text("home.theme.synchronized")}
					</StatusMessage>
					<div className="mt-3 rounded-md border border-accent bg-accent-soft p-3 text-sm text-text">
						{text("home.theme.accent-sample")}
					</div>
				</section>
				<section
					aria-labelledby="fixture-catalog-title"
					className="flex flex-col items-center gap-2"
				>
					<h2 id="fixture-catalog-title" className="font-display text-lg">
						{text("home.catalog.title")}
					</h2>
					<StatusMessage id="fixture-catalog-status" tone={catalogTones[catalog.status]}>
						{catalogStatusMessage}
					</StatusMessage>
					<Button
						onClick={catalog.refetch}
						disabled={catalog.isFetching}
						aria-describedby="fixture-catalog-status"
					>
						{text("home.catalog.refresh")}
					</Button>
				</section>
				<section
					aria-labelledby="fixture-greeting-title"
					className="flex flex-col items-center gap-2"
				>
					<h2 id="fixture-greeting-title" className="font-display text-lg">
						{text("home.greeting.title")}
					</h2>
					<StatusMessage tone={greetingTones[greeting.status]}>{greetingMessage}</StatusMessage>
					{greeting.status === "error" ? (
						<Button variant="secondary" onClick={() => requestGreeting(requested)}>
							{text("common.action.try-again")}
						</Button>
					) : null}
					<Button onClick={() => requestGreeting("Ryot")}>{text("home.greeting.fetch")}</Button>
					<Button variant="ghost" onClick={() => requestGreeting("")}>
						{text("home.greeting.fetch-unnamed")}
					</Button>
					<Button variant="ghost" onClick={() => greeting.mutate({ name: Number.NaN })}>
						{text("home.greeting.fetch-invalid")}
					</Button>
				</section>
				<section
					aria-labelledby="fixture-upload-title"
					className="flex flex-col items-center gap-3"
				>
					<h2 id="fixture-upload-title" className="font-display text-lg">
						{text("home.upload.title")}
					</h2>
					<StatusMessage tone={uploadTones[upload.status]}>{uploadMessage}</StatusMessage>
					<label className="flex flex-col items-center gap-1">
						<span>{text("home.upload.choose")}</span>
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
						{text("home.permanent-upload.title")}
					</h2>
					<StatusMessage tone={uploadTones[permanentUpload.status]}>
						{permanentUploadMessage}
					</StatusMessage>
					<label className="flex flex-col items-center gap-1">
						<span>{text("home.permanent-upload.choose")}</span>
						<input
							type="file"
							accept="image/png"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (file === undefined) {
									return;
								}
								setPermanentUploadName(file.name);
								permanentUpload.mutate(file);
							}}
						/>
					</label>
					{permanentAsset === undefined ? null : (
						<ManagedAssetProvider assets={[permanentAsset]}>
							<PermanentUploadImage asset={permanentAsset} />
						</ManagedAssetProvider>
					)}
				</section>
				<PluginLink to={fixtureRoute("/details/item-1", { tab: "stats" })}>
					{text("home.link.item-1")}
				</PluginLink>
				<Button
					variant="secondary"
					onClick={() => ryot.navigation.push(fixtureRoute("/details/item-2"))}
				>
					{text("home.link.item-2")}
				</Button>
				<PluginLink to={fixtureRoute("/full-bleed")}>{text("full-bleed.heading")}</PluginLink>
				<PluginLink to={{ kind: "entity", entityId: "fixture-entity" }}>
					{text("home.link.entity")}
				</PluginLink>
			</div>
		</PluginScreenFrame>
	);
};

export default Home;
