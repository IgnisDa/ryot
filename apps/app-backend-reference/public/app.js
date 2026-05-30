const $ = (id) => document.getElementById(id);
const audibleSandboxScriptSlug = "audiobook.audible";

// --- API helpers ---

async function apiFetch(method, path, body) {
	const hasBody = body !== undefined && method !== "GET";
	const res = await fetch(path, {
		...(hasBody ? { body: JSON.stringify(body) } : {}),
		credentials: "include",
		headers: hasBody ? { "Content-Type": "application/json" } : {},
		method,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data.message ?? data.title ?? JSON.stringify(data));
	}
	return data;
}

const get = (path) => apiFetch("GET", path);
const post = (path, body) => apiFetch("POST", path, body);

async function uploadTemporary(file) {
	const formData = new FormData();
	formData.append("files", file, file.name);
	const res = await fetch("/api/uploads/temporary", {
		method: "POST",
		body: formData,
		credentials: "include",
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data.message ?? data.title ?? JSON.stringify(data));
	}
	return data;
}

// --- Auth ---

$("signin-form").addEventListener("submit", (e) => {
	e.preventDefault();
	$("auth-error").textContent = "";
	void (async () => {
		try {
			const data = await post("/api/auth/sign-in/email", {
				email: $("email").value,
				password: $("password").value,
			});
			$("user-info").textContent = data.user?.email ?? "";
			$("auth-section").hidden = true;
			$("app-sections").hidden = false;
			$("sandbox-context").value = JSON.stringify({ query: "Dune", page: 1, pageSize: 3 }, null, 2);
			void loadAudibleList();
		} catch (err) {
			$("auth-error").textContent = err.message;
		}
	})();
});

$("signup-btn").addEventListener("click", () => {
	$("auth-error").textContent = "";
	void (async () => {
		try {
			await post("/api/auth/sign-up/email", {
				email: $("email").value,
				name: $("email").value.split("@")[0],
				password: $("password").value,
			});
			$("auth-error").textContent = "Signed up — now sign in.";
		} catch (err) {
			$("auth-error").textContent = err.message;
		}
	})();
});

// --- Audible runs ---

$("audible-query-form").addEventListener("submit", (e) => {
	e.preventDefault();
	$("audible-error").textContent = "";
	const query = $("audible-query").value.trim();
	void (async () => {
		try {
			const detail = await post("/api/audible/runs", query ? { query } : {});
			upsertAudibleCard(detail);
			scheduleAudiblePoll(detail.run.id);
			$("audible-query").value = "";
		} catch (err) {
			$("audible-error").textContent = err.message;
		}
	})();
});

$("audible-upload-form").addEventListener("submit", (e) => {
	e.preventDefault();
	$("audible-error").textContent = "";
	const file = $("audible-upload").files?.[0] ?? null;
	void (async () => {
		try {
			if (!file) {
				throw new Error("Choose a .txt file first");
			}
			const uploads = await uploadTemporary(file);
			const uploadId = uploads[0]?.id;
			if (!uploadId) {
				throw new Error("Upload did not return an id");
			}
			const detail = await post("/api/audible/runs", { uploadId });
			upsertAudibleCard(detail);
			scheduleAudiblePoll(detail.run.id);
			$("audible-upload").value = "";
		} catch (err) {
			$("audible-error").textContent = err.message;
		}
	})();
});

async function loadAudibleList() {
	try {
		const list = await get("/api/audible/runs");
		for (const run of list) {
			upsertAudibleCard({ items: [], finalResult: null, run, steps: [] });
			if (!isTerminal(run.status)) {
				scheduleAudiblePoll(run.id);
			}
		}
	} catch (err) {
		$("audible-error").textContent = err.message;
	}
}

function upsertAudibleCard(detail) {
	const { items, run, steps, finalResult } = detail;
	let card = $(`audible-${run.id}`);
	if (!card) {
		card = document.createElement("div");
		card.className = "card";
		card.id = `audible-${run.id}`;
		$("audible-list").prepend(card);
	}
	const stepList = steps.map((s) => `<li>${s.name}: ${s.status}</li>`).join("");
	const itemList = items
		.map((item) => {
			const label = item.title ?? item.query;
			const author = item.author ? ` by ${item.author}` : "";
			const asin = item.asin ? ` (${item.asin})` : "";
			return `<li>${label}${author}${asin} <span class="status ${item.status}">${item.status}</span></li>`;
		})
		.join("");
	card.innerHTML = `
    <strong>${run.query ?? `Batch upload ${run.uploadId}`}</strong>
    <span class="status ${run.status}">${run.status}</span>
    <div style="color:#888;font-size:.8rem">${run.id}</div>
    ${finalResult ? `<div style="margin-top:.4rem">${finalResult.matchedItems}/${finalResult.processedQueries} queries matched</div>` : ""}
    ${stepList ? `<ul style="margin:.3rem 0 0;padding-left:1.2rem">${stepList}</ul>` : ""}
    ${itemList ? `<div style="margin-top:.4rem"><strong>Items:</strong><ul style="margin:.2rem 0 0;padding-left:1.2rem">${itemList}</ul></div>` : ""}
  `;
}

function scheduleAudiblePoll(id) {
	const interval = setInterval(async () => {
		try {
			const detail = await get(`/api/audible/runs/${id}`);
			upsertAudibleCard(detail);
			if (isTerminal(detail.run.status)) {
				clearInterval(interval);
			}
		} catch {
			clearInterval(interval);
		}
	}, 2000);
}

// --- Sandbox ---

$("sandbox-form").addEventListener("submit", (e) => {
	e.preventDefault();
	$("sandbox-result").innerHTML = '<div class="card">Running…</div>';
	void (async () => {
		try {
			const driverName = $("sandbox-driver").value;
			const context = JSON.parse($("sandbox-context").value ?? "{}");
			const result = await post("/api/sandbox/run", {
				context,
				driverName,
				scriptSlug: audibleSandboxScriptSlug,
			});
			renderSandboxResult(result);
			if (!isTerminal(result.status)) {
				scheduleSandboxPoll(result.id);
			}
		} catch (err) {
			$("sandbox-result").innerHTML = `<div class="card error">${err.message}</div>`;
		}
	})();
});

function renderSandboxResult(result) {
	$("sandbox-result").innerHTML = `
    <div class="card">
      <span class="status ${result.status}">${result.status}</span>
      <div style="color:#888;font-size:.8rem">${result.scriptSlug} · ${result.driverName}</div>
      ${result.logs ? `<pre>${escHtml(result.logs)}</pre>` : ""}
      ${result.result !== null ? `<pre>${escHtml(JSON.stringify(result.result, null, 2))}</pre>` : ""}
      ${result.error ? `<pre style="color:#dc2626">${escHtml(result.error)}</pre>` : ""}
    </div>
  `;
}

function scheduleSandboxPoll(id) {
	const interval = setInterval(async () => {
		try {
			const result = await get(`/api/sandbox/run/${id}`);
			renderSandboxResult(result);
			if (isTerminal(result.status)) {
				clearInterval(interval);
			}
		} catch {
			clearInterval(interval);
		}
	}, 1000);
}

// --- Utils ---

function isTerminal(status) {
	return status === "completed" || status === "failed";
}

function escHtml(str) {
	return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
