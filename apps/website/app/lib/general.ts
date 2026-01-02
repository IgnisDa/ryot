import { initializePaddle } from "@paddle/paddle-js";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { $path } from "safe-routes";
import { withFragment } from "ufo";
import type { TPrices } from "./config.server";

export const startUrl = withFragment($path("/"), "start-here");

export const logoUrl =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";

export const contactEmail = "ignisda2001@gmail.com";

export const initializePaddleForApplication = (
	clientToken: string,
	isSandbox: boolean,
	paddleCustomerId?: string | null,
) =>
	initializePaddle({
		token: clientToken,
		environment: isSandbox ? "sandbox" : undefined,
		pwCustomer: { id: paddleCustomerId || undefined },
	});

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 2,
			staleTime: 1000 * 60 * 5, // 5 minutes
			placeholderData: (prev: unknown) => prev,
		},
	},
});

export const useConfigData = () => {
	return useQuery({
		staleTime: 1000 * 60 * 5,
		queryKey: ["website-config"],
		queryFn: async () => {
			const response = await fetch("/api/config");
			if (!response.ok) throw new Error("Failed to fetch config");
			return response.json() as Promise<{
				prices: TPrices;
				isSandbox: boolean;
				clientToken: string;
				isLoggedIn: boolean;
				turnstileSiteKey: string;
			}>;
		},
	});
};
