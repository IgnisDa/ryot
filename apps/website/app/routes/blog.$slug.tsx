import { ArrowLeft } from "lucide-react";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { getBlogPost } from "~/content/blog-registry";
import { Badge } from "~/lib/components/ui/badge";
import type { Route } from "./+types/blog.$slug";

export function loader({ params }: Route.LoaderArgs) {
	if (!getBlogPost(params.slug)) {
		throw new Response("Not Found", { status: 404 });
	}

	return null;
}

export const meta: MetaFunction<typeof loader> = ({ params }) => {
	const post = getBlogPost(params.slug);

	if (!post) {
		return [{ title: "Page not found | Ryot" }];
	}

	return [
		{ title: `${post.frontmatter.title} | Ryot` },
		{ name: "description", content: post.frontmatter.description },
	];
};

export default function Page(props: Route.ComponentProps) {
	const post = getBlogPost(props.params.slug);

	if (!post) return null;

	const Article = post.content;
	const publishedDate = new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		dateStyle: "long",
	}).format(new Date(`${post.frontmatter.publishedAt}T00:00:00Z`));

	return (
		<>
			<section className="border-b bg-muted/30 py-12 lg:py-20">
				<div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
					<Link
						to={$path("/")}
						className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="size-4" />
						Back to Ryot
					</Link>
					<div className="mt-8 flex flex-wrap gap-2">
						{post.frontmatter.properties.labels.map((label) => (
							<Badge key={label} variant="secondary" className="capitalize">
								{label}
							</Badge>
						))}
					</div>
					<h1 className="mt-6 text-4xl font-bold leading-tight text-foreground lg:text-6xl">
						{post.frontmatter.title}
					</h1>
					<p className="mt-4 text-sm text-muted-foreground">
						<time dateTime={post.frontmatter.publishedAt}>
							Published on {publishedDate}
						</time>
					</p>
					<p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
						{post.frontmatter.description}
					</p>
				</div>
			</section>

			<section className="py-10 lg:py-16">
				<div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-16 lg:px-8">
					<article className="blog-prose order-2 min-w-0 lg:order-1">
						<Article />
					</article>
					{post.tableOfContents?.length ? (
						<aside className="order-1 lg:order-2">
							<div className="rounded-lg border bg-muted/20 p-5 lg:sticky lg:top-24">
								<p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
									On this page
								</p>
								<nav aria-label="Table of contents" className="space-y-2">
									{post.tableOfContents.map((item) => (
										<a
											key={item.id}
											href={`#${item.id}`}
											className={`block text-sm leading-snug text-muted-foreground transition-colors hover:text-foreground ${item.depth === 3 ? "pl-3 text-xs" : ""}`}
										>
											{item.label}
										</a>
									))}
								</nav>
							</div>
						</aside>
					) : null}
				</div>
			</section>
		</>
	);
}
