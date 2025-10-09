import { cn } from "@ryot/ts-utils";
import {
	Link,
	Links,
	type LinksFunction,
	type LoaderFunctionArgs,
	Meta,
	type MetaFunction,
	Outlet,
	Scripts,
	ScrollRestoration,
	isRouteErrorResponse,
	useLoaderData,
	useLocation,
	useRouteError,
} from "react-router";
import { HoneypotProvider } from "remix-utils/honeypot/react";
import { $path } from "safe-routes";
import { withFragment } from "ufo";
import { Button } from "./lib/components/ui/button";
import { Toaster } from "./lib/components/ui/sonner";
import { honeypot } from "./lib/config.server";
import { logoUrl, startUrl } from "./lib/constants";
import { getCustomerFromCookie } from "./lib/utilities.server";
import "./tailwind.css";

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
	const location = useLocation();
	const loaderData = useLoaderData<typeof loader>();

	const isActivePage = (path: string) => {
		if (path === "/") return location.pathname === "/" && location.hash === "";
		return location.pathname.startsWith(path);
	};

	const isActiveFragment = (fragment: string) => {
		if (location.pathname !== "/") return false;
		return location.hash === `#${fragment}`;
	};

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
			<body className="font-body">
				<Toaster />
				<div className="flex flex-col min-h-dvh">
					<header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
						<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
							<div className="flex items-center justify-between h-16">
								<div className="flex items-center space-x-3">
									<Link to={$path("/")} className="flex items-center space-x-3">
										<img
											alt="Ryot"
											src={logoUrl}
											className="w-8 h-8 object-contain"
										/>
										<span className="text-xl font-semibold text-foreground">
											Ryot
										</span>
									</Link>
								</div>

								<nav className="hidden md:flex items-center space-x-8">
									<Link
										to={$path("/")}
										className={cn(
											"transition-colors",
											isActivePage("/")
												? "text-primary font-medium"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										Home
									</Link>
									<Link
										to={$path("/features")}
										className={cn(
											"transition-colors",
											isActivePage("/features")
												? "text-primary font-medium"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										Features
									</Link>
									<Link
										to={withFragment($path("/"), "pricing")}
										className={cn(
											"transition-colors",
											isActiveFragment("pricing")
												? "text-primary font-medium"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										Pricing
									</Link>
									<Link
										to={withFragment($path("/"), "contact")}
										className={cn(
											"transition-colors",
											isActiveFragment("contact")
												? "text-primary font-medium"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										Contact
									</Link>
									<a
										target="_blank"
										href="https://docs.ryot.io"
										rel="noopener noreferrer"
										className="text-muted-foreground hover:text-foreground transition-colors"
									>
										Docs
									</a>
								</nav>

								<div className="flex items-center space-x-4">
									{loaderData.isLoggedIn ? (
										<Link to={$path("/me")}>
											<Button variant="ghost" size="sm">
												Dashboard
											</Button>
										</Link>
									) : (
										<Link to={startUrl}>
											<Button size="sm">Get Started</Button>
										</Link>
									)}
								</div>
							</div>
						</div>
					</header>
					<main className="flex-1">
						<HoneypotProvider {...loaderData.honeypotInputProps}>
							<Outlet />
						</HoneypotProvider>
					</main>
					<footer className="border-t border-border/50 py-12 bg-muted/20">
						<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
							<div className="flex flex-col md:flex-row justify-between items-center">
								<div className="flex items-center space-x-3 mb-4 md:mb-0">
									<img
										src={logoUrl}
										alt="Ryot Logo"
										className="w-8 h-8 object-contain"
									/>
									<span className="text-xl font-semibold text-foreground">
										Ryot
									</span>
								</div>
								<div className="flex items-center space-x-6 text-muted-foreground">
									<Link
										to={$path("/features")}
										className="hover:text-foreground transition-colors"
									>
										Features
									</Link>
									<Link
										to={withFragment($path("/"), "contact")}
										className="hover:text-foreground transition-colors"
									>
										Support
									</Link>
									<Link
										to={$path("/terms")}
										className="hover:text-foreground hidden sm:block transition-colors"
									>
										Terms
									</Link>
									<a
										href="https://docs.ryot.io"
										target="_blank"
										rel="noopener noreferrer"
										className="hover:text-foreground transition-colors"
									>
										Docs
									</a>
									<a
										href="https://github.com/IgnisDa/ryot"
										target="_blank"
										rel="noopener noreferrer"
										className="hover:text-foreground transition-colors"
									>
										GitHub
									</a>
								</div>
							</div>
							<div className="border-t border-border/50 mt-8 pt-8 text-center text-muted-foreground">
								<p>&copy; 2025 Ryot. All rights reserved.</p>
							</div>
						</div>
					</footer>
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
