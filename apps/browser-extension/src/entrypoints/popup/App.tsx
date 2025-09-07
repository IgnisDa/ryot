import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import logo from "~/assets/icon.png";
import { storage } from "#imports";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../../lib/constants";
import { ExtensionStatus, type FormState } from "../../lib/extension-types";
import { logger } from "../../lib/logger";

const getStatusMessage = (status: ExtensionStatus): string => {
	return match(status)
		.with(ExtensionStatus.Idle, () => "Idle, please watch a video to start")
		.with(
			ExtensionStatus.VideoDetected,
			() => "Video found, starting tracking...",
		)
		.with(
			ExtensionStatus.LookupInProgress,
			() => "Metadata lookup under way...",
		)
		.with(ExtensionStatus.TrackingActive, () => "Tracking active")
		.with(
			ExtensionStatus.LookupFailed,
			() => "Metadata lookup failed - extension inactive",
		)
		.exhaustive();
};

const App = () => {
	const [currentPage, setCurrentPage] = useState<"main" | "settings">("main");
	const [url, setUrl] = useState("");
	const [formState, setFormState] = useState<FormState>({ status: "idle" });
	const [extensionStatus, setExtensionStatus] =
		useState<ExtensionStatus | null>(null);
	const [currentVideoTitle, setCurrentVideoTitle] = useState<string | null>(
		null,
	);
	const [debugMode, setDebugMode] = useState(false);

	const validateUrl = (urlString: string) => {
		if (!urlString.trim()) {
			setFormState((prev) => ({ ...prev, error: undefined }));
			return false;
		}

		try {
			const url = new URL(urlString);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				setFormState((prev) => ({
					...prev,
					error: "URL must start with http:// or https://",
				}));
				return false;
			}
			setFormState((prev) => ({ ...prev, error: undefined }));
			return true;
		} catch {
			setFormState((prev) => ({ ...prev, error: "Please enter a valid URL" }));
			return false;
		}
	};

	useEffect(() => {
		const loadSavedUrl = async () => {
			const savedUrl = await storage.getItem<string>(
				STORAGE_KEYS.INTEGRATION_URL,
			);
			if (savedUrl) {
				setUrl(savedUrl);
				validateUrl(savedUrl);
				setFormState({ status: "submitted" });
			}
		};

		const loadExtensionStatus = async () => {
			try {
				const response = await browser.runtime.sendMessage({
					type: MESSAGE_TYPES.GET_STATUS,
				});
				if (response.success) {
					setExtensionStatus(response.data);
				}
			} catch (error) {
				logger.error("Failed to get extension status", { error });
			}
		};

		const loadCurrentVideoTitle = async () => {
			try {
				const response = await browser.runtime.sendMessage({
					type: MESSAGE_TYPES.GET_CACHED_TITLE,
				});
				if (response.success) {
					setCurrentVideoTitle(response.data);
				}
			} catch (error) {
				logger.error("Failed to get cached title", { error });
			}
		};

		const loadDebugMode = async () => {
			const savedDebugMode = await storage.getItem<boolean>(
				STORAGE_KEYS.DEBUG_MODE,
			);
			setDebugMode(savedDebugMode || false);
		};

		loadSavedUrl();
		loadExtensionStatus();
		loadCurrentVideoTitle();
		loadDebugMode();

		const handleStorageChange = () => {
			loadExtensionStatus();
			loadCurrentVideoTitle();
		};

		const unwatch = storage.watch(
			STORAGE_KEYS.EXTENSION_STATUS,
			handleStorageChange,
		);

		return unwatch;
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!validateUrl(url)) return;

		setFormState({ status: "submitting" });
		await storage.setItem(STORAGE_KEYS.INTEGRATION_URL, url);
		setFormState({ status: "submitted" });
	};

	const handleClear = async () => {
		await storage.clear("local");
		setUrl("");
		setFormState({ status: "idle" });
		setExtensionStatus(null);
		setCurrentVideoTitle(null);
		setDebugMode(false);
		setCurrentPage("main");
	};

	const handleDebugModeChange = async (enabled: boolean) => {
		setDebugMode(enabled);
		await storage.setItem(STORAGE_KEYS.DEBUG_MODE, enabled);
	};

	if (currentPage === "settings") {
		return (
			<div className="w-[300px] p-5 font-sans">
				<div className="flex items-center justify-between mb-5">
					<button
						type="button"
						onClick={() => setCurrentPage("main")}
						className="text-blue-600 text-sm hover:text-blue-700 transition-colors"
					>
						← Back
					</button>
					<h1 className="text-xl font-semibold text-gray-800">Settings</h1>
					<div className="w-10" />
				</div>
				<div className="space-y-4">
					<div className="p-4 bg-gray-50 rounded-md">
						<h3 className="font-medium text-gray-800 mb-3">Debug Mode</h3>
						<div className="flex items-center gap-3">
							<input
								type="checkbox"
								id="debug-mode"
								checked={debugMode}
								onChange={(e) => handleDebugModeChange(e.target.checked)}
								className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded"
							/>
							<label htmlFor="debug-mode" className="text-sm text-gray-700">
								Enable debug logging
							</label>
						</div>
						<p className="text-xs text-gray-500 mt-2">
							Show detailed debug logs in browser console for troubleshooting.
						</p>
					</div>
					<div className="p-4 bg-gray-50 rounded-md">
						<h3 className="font-medium text-gray-800 mb-2">Reset Extension</h3>
						<p className="text-sm text-gray-600 mb-3">
							Clear all extension data including integration URL, cached
							metadata, and status information.
						</p>
						<button
							type="button"
							onClick={handleClear}
							className="w-full py-2.5 px-4 bg-red-500 text-white border-none rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-red-600"
						>
							Clear All Data
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="w-[300px] p-5 font-sans">
			<div className="flex items-center justify-between mb-5">
				<div className="flex items-center gap-2">
					<img src={logo} alt="Ryot Logo" className="w-8 h-8" />
					<h1 className="text-2xl font-semibold text-gray-800">Ryot</h1>
				</div>
				<button
					type="button"
					onClick={() => setCurrentPage("settings")}
					className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
					title="Settings"
				>
					<Settings size={18} />
				</button>
			</div>
			<form onSubmit={handleSubmit} className="flex flex-col gap-3">
				{formState.status !== "submitted" && (
					<>
						<label
							htmlFor="url-input"
							className="text-sm font-medium text-gray-600 mb-1"
						>
							Integration URL
						</label>
						<input
							type="text"
							value={url}
							id="url-input"
							className={`w-full py-2.5 px-3 border-2 rounded-md text-sm transition-colors box-border focus:outline-none ${formState.error ? "border-red-500 focus:border-red-500" : "border-gray-300 focus:border-blue-600"}`}
							onChange={(e) => {
								const newUrl = e.target.value;
								setUrl(newUrl);
								validateUrl(newUrl);
							}}
							placeholder="Enter your integration URL"
						/>
						{formState.error && (
							<div className="text-red-500 text-xs mt-1">{formState.error}</div>
						)}
					</>
				)}
				<div className="flex gap-2 mt-2">
					{formState.status !== "submitted" && (
						<button
							type="submit"
							className="flex-[2] py-2.5 px-4 bg-blue-600 text-white border-none rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
							disabled={
								formState.status === "submitting" ||
								!url.trim() ||
								!!formState.error
							}
						>
							{formState.status === "submitting" ? "Saving..." : "Submit"}
						</button>
					)}
					{formState.status === "submitted" && (
						<div className="w-full">
							{extensionStatus ? (
								<div
									className={`p-3 rounded-md ${
										extensionStatus === ExtensionStatus.LookupFailed
											? "bg-red-50"
											: extensionStatus === ExtensionStatus.TrackingActive
												? "bg-green-50"
												: "bg-gray-100"
									}`}
								>
									<div
										className={`text-sm font-medium mb-1 ${
											extensionStatus === ExtensionStatus.LookupFailed
												? "text-red-800"
												: extensionStatus === ExtensionStatus.TrackingActive
													? "text-green-800"
													: "text-gray-800"
										}`}
									>
										Status: {getStatusMessage(extensionStatus)}
									</div>
									{currentVideoTitle &&
										extensionStatus !== ExtensionStatus.Idle && (
											<div className="text-xs text-gray-600 mb-1">
												{currentVideoTitle}
											</div>
										)}
								</div>
							) : (
								<div className="p-3 bg-gray-100 rounded-md text-sm text-gray-600">
									{getStatusMessage(ExtensionStatus.Idle)}
								</div>
							)}
						</div>
					)}
				</div>
			</form>
		</div>
	);
};

export default App;
