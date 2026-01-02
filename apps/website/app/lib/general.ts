import { initializePaddle } from "@paddle/paddle-js";
import { QueryClient } from "@tanstack/react-query";
import { $path } from "safe-routes";
import { withFragment } from "ufo";

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
