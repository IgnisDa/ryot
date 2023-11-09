import { createCookie } from "@remix-run/node";
import { COOKIES_KEYS } from "~/lib/constants";

export const authCookie = createCookie(COOKIES_KEYS.authCookieName, {});
