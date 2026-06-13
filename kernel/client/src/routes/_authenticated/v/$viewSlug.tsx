import { RyotClientError } from "@ryot-app/client-sdk";
import { Button } from "@ryot-app/client-ui-sdk";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";

import { collectManagedAssets, ManagedAssetsService } from "#/modules/assets/managed-assets";
import { SavedViewGrid } from "#/modules/saved-views/grid";
import { SavedViewLoadError, SavedViewsService } from "#/modules/saved-views/service";

export const Route = createFileRoute("/_authenticated/v/$viewSlug")({
	component: SavedViewPage,
	pendingComponent: SavedViewPending,
	errorComponent: SavedViewError,
	notFoundComponent: SavedViewNotFound,
	loader: async ({ abortController, context, params, parentMatchPromise }) => {
		const slug = params.viewSlug.trim();
		if (slug.length === 0) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		const parentMatch = await parentMatchPromise;
		const parentData = parentMatch.loaderData;
		if (parentData === undefined) {
			throw new SavedViewLoadError({
				stage: "record",
				cause: new Error("Authenticated route data is unavailable"),
			});
		}
		const data = await context.runtime.runPromise(
			Effect.flatMap(SavedViewsService, (service) => service.loadGrid(parentData.ryot, slug)),
			{ signal: abortController.signal },
		);
		if (data === null) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		const assets = collectManagedAssets(data.page.items.map((item) => item.image));
		const managedUrls = await context.runtime.runPromise(
			Effect.flatMap(ManagedAssetsService, (service) =>
				service.resolve(context.scope, assets),
			).pipe(Effect.catch(() => Effect.succeed(new Map<string, string>()))),
			{ signal: abortController.signal },
		);
		return { ...data, managedUrls };
	},
});

function SavedViewPage() {
	const { managedUrls, page, record } = Route.useLoaderData();
	const resultCount = page.pageInfo.hasMore
		? `${page.items.length}+ results`
		: resultLabel(page.items.length);
	return (
		<main className="h-full overflow-y-auto px-5 pt-7 pb-[max(32px,env(safe-area-inset-bottom))] md:px-8 md:pt-9">
			<div className="mx-auto grid w-full max-w-7xl gap-7">
				<header>
					<p className="ui-overline">Saved view</p>
					<h1 className="font-display text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
						{record.name}
					</h1>
					<p className="mt-2 text-sm text-text-muted">{resultCount}</p>
				</header>
				{page.items.length === 0 ? (
					<section className="ui-card py-10 text-center">
						<h2 className="text-lg font-semibold">{record.name} is empty</h2>
						<p className="ui-subtitle">There are no items in this saved view.</p>
					</section>
				) : (
					<SavedViewGrid items={page.items} managedUrls={managedUrls} />
				)}
			</div>
		</main>
	);
}

const resultLabel = (count: number) => `${count} ${count === 1 ? "result" : "results"}`;

function SavedViewPending() {
	return <SavedViewNotice title="Loading saved view" message="Loading saved view..." />;
}

function SavedViewNotFound() {
	return <SavedViewNotice title="Saved view not found" message="This saved view does not exist." />;
}

function SavedViewError(props: { readonly error: Error }) {
	const router = useRouter();
	const invalidDefinition =
		props.error instanceof SavedViewLoadError &&
		props.error.stage === "page" &&
		(!(props.error.cause instanceof RyotClientError) ||
			props.error.cause.reason === "malformed-result");
	return (
		<SavedViewNotice
			action={<Button onClick={() => void router.invalidate()}>Retry</Button>}
			title={invalidDefinition ? "Saved view cannot be displayed" : "Saved view unavailable"}
			message={
				invalidDefinition
					? "This saved view has an invalid definition."
					: "The saved view could not be loaded."
			}
		/>
	);
}

function SavedViewNotice(props: {
	readonly title: string;
	readonly message: string;
	readonly action?: React.ReactNode;
}) {
	return (
		<main className="ui-page">
			<section
				aria-labelledby="saved-view-notice-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="saved-view-notice-title" className="ui-heading">
						{props.title}
					</h1>
					<p role="status" className="ui-subtitle">
						{props.message}
					</p>
				</div>
				{props.action}
			</section>
		</main>
	);
}
