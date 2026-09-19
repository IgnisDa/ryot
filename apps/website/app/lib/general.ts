import { initializePaddle } from "@paddle/paddle-js";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { $path } from "safe-routes";
import { withFragment } from "ufo";

import type { TPrices } from "./config.server";

type ConfigData = {
	prices: TPrices;
	isSandbox: boolean;
	clientToken: string;
	isLoggedIn: boolean;
	turnstileSiteKey: string;
};

export const contactEmail = "ignisda2001@gmail.com";
export const startUrl = withFragment($path("/"), "start-here");
// TODO: Use a URL like https://ryot.op/icon.png and update upstream including paddle and polar
export const logoUrl =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/packages/assets/icon-512x512.png";

export const initializePaddleForApplication = (
	clientToken: string,
	isSandbox: boolean,
	paddleCustomerId?: string | null,
) =>
	initializePaddle({
		token: clientToken,
		environment: isSandbox ? "sandbox" : undefined,
		pwCustomer: { id: paddleCustomerId ?? undefined },
	});

export const queryClient = new QueryClient({
	defaultOptions: { queries: { placeholderData: (prev: unknown) => prev } },
});

export const useConfigData = () =>
	useQuery({
		queryKey: ["websiteConfig"],
		queryFn: () =>
			fetch("/api/config").then((response) => {
				if (!response.ok) {
					throw new Error("Failed to fetch config");
				}
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Same-origin response produced by the api.config loader
				return response.json() as Promise<ConfigData>;
			}),
	});
