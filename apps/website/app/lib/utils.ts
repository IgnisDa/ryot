import { type ClassValue, clsx } from "clsx";
import { $path } from "remix-routes";
import { twMerge } from "tailwind-merge";
import { withFragment } from "ufo";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const startUrl = withFragment($path("/"), "start-here");

export const logoUrl =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
