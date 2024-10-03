import {
	Link,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
} from "@remix-run/react";
import { HoneypotProvider } from "remix-utils/honeypot/react";
import "./tailwind.css";
import {
	type LinksFunction,
	type MetaFunction,
	json,
	unstable_defineLoader,
} from "@remix-run/node";
import { $path } from "remix-routes";
import { withFragment } from "ufo";
import { Toaster } from "./lib/components/ui/sonner";
import { getUserIdFromCookie, honeypot } from "./lib/config.server";

export const links: LinksFunction = () => {
	return [
		{
			rel: "icon",
			type: "image/png",
			sizes: "16x16",
			href: "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/favicon-16x16.png",
		},
		{
			rel: "icon",
			type: "image/png",
			sizes: "32x32",
			href: "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/favicon-32x32.png",
		},
		{
			rel: "stylesheet",
			href: "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap",
		},
	];
};

export const loader = unstable_defineLoader(async ({ request }) => {
	const userId = await getUserIdFromCookie(request);
	return json({
		isLoggedIn: !!userId,
		honeypotInputProps: honeypot.getInputProps(),
	});
});

export const meta: MetaFunction = () => {
	return [{ title: "Ryot" }];
};

export default function App() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<html lang="en" className="scroll-smooth">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
				<script
					defer
					data-website-id="65cf9bb3-381b-4ea4-b87d-b40a23a0204f"
					src="https://umami.diptesh.me/script.js"
					data-domains="ryot.io,www.ryot.io"
				/>
			</head>
			<body>
				<Toaster />
				<div className="flex flex-col min-h-dvh">
					<header className="px-4 lg:px-6 h-14 flex items-center">
						<Link to={$path("/")} className="flex items-center justify-center">
							<img
								src="https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png"
								alt="Ryot"
								className="size-10 mr-2"
							/>
							<span className="text-xl hidden md:block">Ryot</span>
						</Link>
						<nav className="ml-auto flex gap-4 sm:gap-6">
							<Link
								to={
									loaderData.isLoggedIn
										? $path("/me")
										: withFragment($path("/"), "start-here")
								}
								className="text-sm font-medium hover:underline underline-offset-4"
							>
								Your account
							</Link>
							<Link
								to={withFragment($path("/"), "pricing")}
								className="text-sm font-medium hover:underline underline-offset-4"
							>
								Pricing
							</Link>
							<a
								target="_blank"
								href="https://docs.ryot.io"
								rel="noopener noreferrer"
								className="text-sm font-medium hover:underline underline-offset-4 hidden md:block"
							>
								Documentation
							</a>
							<Link
								to={withFragment($path("/"), "contact")}
								className="text-sm font-medium hover:underline underline-offset-4"
							>
								Contact Us
							</Link>
							<Link
								to={$path("/terms")}
								className="text-sm font-medium hover:underline underline-offset-4 hidden md:block"
							>
								Terms
							</Link>
						</nav>
					</header>
					<main className="flex-1">
						<HoneypotProvider {...loaderData.honeypotInputProps}>
							<Outlet />
						</HoneypotProvider>
					</main>
				</div>
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}
