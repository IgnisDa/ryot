import { createCookie, createCookieSessionStorage } from "@remix-run/node";
import { ApplicationKey } from "./generals";

export const authCookie = createCookie(ApplicationKey.Auth, {});
export const colorSchemeCookie = createCookie(ApplicationKey.ColorScheme, {
	maxAge: 60 * 60 * 24 * 365,
});
export const toastSessionStorage = createCookieSessionStorage({
	cookie: {
		name: "en_toast",
		sameSite: "lax",
		path: "/",
		httpOnly: true,
		secrets: (process.env.SESSION_SECRET || "").split(","),
		secure: process.env.NODE_ENV === "production",
	},
});
