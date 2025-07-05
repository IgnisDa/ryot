export const MEDIA_DETAILS_HEIGHT = { base: "45vh", "2xl": "55vh" };

export const LOGO_IMAGE_URL =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
export const redirectToQueryParam = "redirectTo";
export const pageQueryParam = "page";
export const FRONTEND_AUTH_COOKIE_NAME = "Auth";
export const toastKey = "Toast";
export const PRO_REQUIRED_MESSAGE = "Ryot pro is required to use this feature";
export const CURRENT_WORKOUT_KEY = "CurrentWorkout";

export const reviewYellow = "#EBE600FF";

export const applicationBaseUrl =
	typeof window !== "undefined" ? window.location.origin : "";

declare global {
	interface Window {
		umami?: { track: (eventName: string, eventData: unknown) => void };
	}
}
