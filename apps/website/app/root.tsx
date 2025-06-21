import {
	isRouteErrorResponse,
	Link,
	Links,
	type LinksFunction,
	type LoaderFunctionArgs,
	Meta,
	type MetaFunction,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
	useRouteError,
} from "react-router";
import { HoneypotProvider } from "remix-utils/honeypot/react";
import "./tailwind.css";
import { $path } from "safe-routes";
import { withFragment } from "ufo";
import { Toaster } from "./lib/components/ui/sonner";
import { getCustomerFromCookie, honeypot } from "./lib/config.server";
import { logoUrl, startUrl } from "./lib/utils";

export const meta: MetaFunction = () => {
	return [
		{ title: "Ryot" },
		{
			name: "description",
			content: "The only self hosted tracker you will ever need.",
		},
	];
};

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const customer = await getCustomerFromCookie(request);
	return {
		isLoggedIn: !!customer,
		honeypotInputProps: await honeypot.getInputProps(),
	};
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
							<img alt="Ryot" src={logoUrl} className="size-10 mr-2" />
							<span className="text-xl hidden md:block">Ryot</span>
						</Link>
						<nav className="ml-auto flex gap-4 sm:gap-6">
							<Link
								to={$path("/features")}
								className="text-sm font-medium hover:underline underline-offset-4"
							>
								Features
							</Link>
							<Link
								to={withFragment($path("/"), "pricing")}
								className="text-sm font-medium hover:underline underline-offset-4"
							>
								Pricing
							</Link>
							<Link
								to={loaderData.isLoggedIn ? $path("/me") : startUrl}
								className="text-sm font-medium hover:underline underline-offset-4"
							>
								Your account
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
								className="text-sm font-medium hover:underline underline-offset-4 hidden md:block"
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

export function ErrorBoundary() {
	const error = useRouteError() as Error;
	const message = isRouteErrorResponse(error)
		? error.data.message
		: error.message;

	return (
		<div>
			<p>We encountered an error: {message}</p>
		</div>
	);
}
