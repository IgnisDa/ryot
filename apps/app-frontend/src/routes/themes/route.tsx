import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/themes")({
	component: ThemesLayout,
});

function ThemesLayout() {
	useEffect(() => {
		const fontLinks = [
			"https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700;900&family=IBM+Plex+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700;900&display=swap",
			"https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700;900&display=swap",
			"https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap",
			"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700;800;900&display=swap",
		];

		const preconnectLinks = [
			{ href: "https://fonts.googleapis.com", crossOrigin: false },
			{ href: "https://fonts.gstatic.com", crossOrigin: true },
		];

		const linkElements: HTMLLinkElement[] = [];

		preconnectLinks.forEach((preconnect) => {
			const link = document.createElement("link");
			link.rel = "preconnect";
			link.href = preconnect.href;
			if (preconnect.crossOrigin) link.crossOrigin = "anonymous";
			document.head.appendChild(link);
			linkElements.push(link);
		});

		fontLinks.forEach((fontHref) => {
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = fontHref;
			document.head.appendChild(link);
			linkElements.push(link);
		});

		return () => {
			linkElements.forEach((link) => {
				if (link.parentNode) {
					link.parentNode.removeChild(link);
				}
			});
		};
	}, []);

	return <Outlet />;
}
