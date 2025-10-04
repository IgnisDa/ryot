# Hardcover Sandbox Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Hardcover book provider support to app-backend sandbox system with search and details functionality.

**Architecture:** Create two sandbox script files using Hardcover's GraphQL API, register them in seed.ts, following exact patterns from OpenLibrary and Google Books implementations.

**Tech Stack:** TypeScript, Hardcover GraphQL API, Sandbox script system

---

## Task 1: Create Hardcover Book Search Script

**Files:**
- Create: `apps/app-backend/src/sandbox/scripts/hardcover-book-search-source.txt`

**Step 1: Create search script file**

Create the file with complete implementation:

```javascript
const pageSize =
	Number.isFinite(Number(context?.pageSize)) &&
	Number(context.pageSize) > 0 &&
	Number(context.pageSize) <= 100
		? Math.floor(Number(context.pageSize))
		: 20;
const currentPage = Number.isFinite(Number(context?.page))
	? Math.max(1, Math.floor(Number(context.page)))
	: 1;
const query = typeof context?.query === "string" ? context.query.trim() : "";

if (!query) throw new Error("query is required");

const configValueResponse = await getAppConfigValue("BOOKS_HARDCOVER_API_KEY");
if (!configValueResponse?.success)
	throw new Error(
		configValueResponse?.error ?? "Could not load Hardcover API key",
	);

const apiKey =
	typeof configValueResponse.data === "string"
		? configValueResponse.data.trim()
		: "";
if (!apiKey) throw new Error("BOOKS_HARDCOVER_API_KEY is not configured");

const graphqlQuery = `
query {
  search(
    page: ${currentPage},
    per_page: ${pageSize},
    query: "${query.replace(/"/g, '\\"')}",
    query_type: "book"
  ) {
    results
  }
}
`;

const response = await httpCall(
	"POST",
	"https://api.hardcover.app/v1/graphql",
	{
		headers: { Authorization: apiKey },
		body: JSON.stringify({ query: graphqlQuery }),
	},
);

if (!response?.success)
	throw new Error(response?.error ?? "Hardcover search request failed");

let payload;
try {
	payload = JSON.parse(response.data.body);
} catch {
	throw new Error("Hardcover returned invalid JSON");
}

const resultsData =
	payload?.data?.search?.results && typeof payload.data.search.results === "object"
		? payload.data.search.results
		: null;

if (!resultsData) throw new Error("Hardcover returned invalid response structure");

const totalItems =
	typeof resultsData.found === "number" && Number.isFinite(resultsData.found)
		? Math.max(0, Math.trunc(resultsData.found))
		: 0;

const hits = Array.isArray(resultsData.hits) ? resultsData.hits : [];
const items = hits
	.map((hit) => {
		const doc = hit?.document;
		if (!doc || typeof doc !== "object") return null;

		const identifier = typeof doc.id === "string" ? doc.id : "";
		if (!identifier) return null;

		const title = typeof doc.title === "string" ? doc.title : "";
		const releaseYear =
			typeof doc.release_year === "number" && Number.isFinite(doc.release_year)
				? doc.release_year
				: null;

		let image = null;
		if (doc.image && typeof doc.image === "object" && typeof doc.image.url === "string")
			image = doc.image.url;

		return {
			title,
			image,
			identifier,
			publish_year: releaseYear,
		};
	})
	.filter((item) => item !== null);

return {
	items,
	details: {
		total_items: totalItems,
		next_page: currentPage * pageSize < totalItems ? currentPage + 1 : null,
	},
};
```

**Step 2: Verify file created**

Run: `ls -la 'apps/app-backend/src/sandbox/scripts/hardcover-book-search-source.txt'`
Expected: File exists

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/sandbox/scripts/hardcover-book-search-source.txt'
git commit -m "feat: add Hardcover book search sandbox script"
```

---

## Task 2: Create Hardcover Book Details Script

**Files:**
- Create: `apps/app-backend/src/sandbox/scripts/hardcover-book-details-source.txt`

**Step 1: Create details script file**

Create the file with complete implementation:

```javascript
const parseJsonResponse = (responseBody) => {
	try {
		return JSON.parse(responseBody);
	} catch {
		throw new Error("Hardcover returned invalid JSON");
	}
};

const toTitleCase = (value) => {
	const words = value
		.toLowerCase()
		.split(/\s+/)
		.filter((word) => word.length > 0);

	return words
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
};

const collectImages = (imageField, imagesArray) => {
	const imageSet = new Set();

	if (imageField && typeof imageField === "object" && typeof imageField.url === "string") {
		const trimmed = imageField.url.trim();
		if (trimmed) imageSet.add(trimmed);
	}

	if (Array.isArray(imagesArray)) {
		for (const img of imagesArray) {
			if (img && typeof img === "object" && typeof img.url === "string") {
				const trimmed = img.url.trim();
				if (trimmed) imageSet.add(trimmed);
			}
		}
	}

	return [...imageSet];
};

const collectPeople = (contributions) => {
	if (!Array.isArray(contributions)) return [];

	const people = [];
	for (const contrib of contributions) {
		if (!contrib || typeof contrib !== "object") continue;

		const authorId = contrib.author_id;
		const author = contrib.author;

		if (!authorId || !author || typeof author !== "object") continue;

		const name = typeof author.name === "string" ? author.name.trim() : "";
		if (!name) continue;

		const role = typeof contrib.contribution === "string" && contrib.contribution.trim()
			? contrib.contribution
			: "Author";

		people.push({
			role,
			source: "hardcover",
			identifier: String(authorId),
		});
	}

	return people;
};

const collectGenres = (cachedTags) => {
	const genreSet = new Set();

	if (!cachedTags || typeof cachedTags !== "object") return [];

	const genreArray = cachedTags.Genre;
	if (!Array.isArray(genreArray)) return [];

	for (const genreItem of genreArray) {
		if (!genreItem || typeof genreItem !== "object") continue;

		const tag = genreItem.tag;
		if (typeof tag !== "string") continue;

		const titleTag = toTitleCase(tag.trim());
		if (titleTag) genreSet.add(titleTag);
	}

	return [...genreSet];
};

const configValueResponse = await getAppConfigValue("BOOKS_HARDCOVER_API_KEY");
if (!configValueResponse?.success)
	throw new Error(
		configValueResponse?.error ?? "Could not load Hardcover API key",
	);

const apiKey =
	typeof configValueResponse.data === "string"
		? configValueResponse.data.trim()
		: "";
if (!apiKey) throw new Error("BOOKS_HARDCOVER_API_KEY is not configured");

const contextIdentifier =
	typeof context?.identifier === "string" ? context.identifier.trim() : "";
if (!contextIdentifier) throw new Error("identifier is required");

const graphqlQuery = `
query {
  books_by_pk(id: ${contextIdentifier}) {
    id
    slug
    pages
    title
    description
    release_year
    image { url }
    images { url }
    cached_tags
    book_series { series { id name } }
    contributions {
      contribution
      author_id
      author { name }
    }
  }
}
`;

const response = await httpCall(
	"POST",
	"https://api.hardcover.app/v1/graphql",
	{
		headers: { Authorization: apiKey },
		body: JSON.stringify({ query: graphqlQuery }),
	},
);

if (!response?.success)
	throw new Error(response?.error ?? "Hardcover details request failed");

const payload = parseJsonResponse(response.data.body);

const bookData =
	payload?.data?.books_by_pk && typeof payload.data.books_by_pk === "object"
		? payload.data.books_by_pk
		: null;

if (!bookData) throw new Error("Hardcover returned no book data");

const title = typeof bookData.title === "string" ? bookData.title : "";
if (!title) throw new Error("Hardcover book data is missing title");

const identifier =
	typeof bookData.id === "string" && bookData.id.trim()
		? bookData.id
		: contextIdentifier;

const pages =
	typeof bookData.pages === "number" && Number.isFinite(bookData.pages)
		? Math.trunc(bookData.pages)
		: null;

const releaseYear =
	typeof bookData.release_year === "number" && Number.isFinite(bookData.release_year)
		? bookData.release_year
		: null;

const slug = typeof bookData.slug === "string" ? bookData.slug.trim() : "";
const sourceUrl = slug
	? `https://hardcover.app/books/${slug}`
	: `https://hardcover.app/books/${identifier}`;

return {
	name: title,
	external_ids: { hardcover: identifier },
	properties: {
		pages,
		people: collectPeople(bookData.contributions),
		genres: collectGenres(bookData.cached_tags),
		publish_year: releaseYear,
		description:
			typeof bookData.description === "string" ? bookData.description : null,
		source_url: sourceUrl,
		assets: {
			remote_images: collectImages(bookData.image, bookData.images),
		},
	},
};
```

**Step 2: Verify file created**

Run: `ls -la 'apps/app-backend/src/sandbox/scripts/hardcover-book-details-source.txt'`
Expected: File exists

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/sandbox/scripts/hardcover-book-details-source.txt'
git commit -m "feat: add Hardcover book details sandbox script"
```

---

## Task 3: Update Seed File to Register Hardcover Scripts

**Files:**
- Modify: `apps/app-backend/src/db/seed.ts`

**Step 1: Add imports at top of file**

After the existing imports (around line 6), add:

```typescript
import hardcoverBookDetailsScriptCode from "../sandbox/scripts/hardcover-book-details-source.txt";
import hardcoverBookSearchScriptCode from "../sandbox/scripts/hardcover-book-search-source.txt";
```

**Step 2: Add slug constants**

After line 19 (after `openLibrarySearchScriptSlug`), add:

```typescript
const hardcoverSearchScriptSlug = "hardcover.book.search";
const hardcoverImportScriptSlug = "hardcover.book.details";
```

**Step 3: Register search script**

After the Google Books search script registration (after line 167), add:

```typescript
	const hardcoverSearchScriptId = await ensureBuiltinSandboxScript({
		name: "Hardcover Book Search",
		slug: hardcoverSearchScriptSlug,
		code: hardcoverBookSearchScriptCode,
	});

	await linkScriptToEntitySchema({
		scriptType: "search",
		entitySchemaId: bookSchemaId,
		scriptId: hardcoverSearchScriptId,
	});
```

**Step 4: Register details script**

After the Google Books import script registration (after line 191), add:

```typescript
	const hardcoverImportScriptId = await ensureBuiltinSandboxScript({
		name: "Hardcover Book Import",
		slug: hardcoverImportScriptSlug,
		code: hardcoverBookDetailsScriptCode,
	});

	await linkScriptToEntitySchema({
		scriptType: "details",
		entitySchemaId: bookSchemaId,
		scriptId: hardcoverImportScriptId,
	});
```

**Step 5: Verify changes**

Run: `cat 'apps/app-backend/src/db/seed.ts' | grep -A 2 'hardcover'`
Expected: See hardcover imports and registrations

**Step 6: Commit**

```bash
git add 'apps/app-backend/src/db/seed.ts'
git commit -m "feat: register Hardcover scripts in database seed"
```

---

## Task 4: Test the Implementation

**Files:**
- None (manual testing)

**Step 1: Build the backend**

Run: `cargo build --release`
Expected: Builds successfully without errors

**Step 2: Run type checking**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: No type errors

**Step 3: Manual verification**

Verify the following files exist:
- `apps/app-backend/src/sandbox/scripts/hardcover-book-search-source.txt`
- `apps/app-backend/src/sandbox/scripts/hardcover-book-details-source.txt`

Verify `seed.ts` imports both scripts and registers them.

**Step 4: Commit if any fixes needed**

If any issues were found and fixed:
```bash
git add .
git commit -m "fix: address issues found during testing"
```

---

## Verification Checklist

After completing all tasks:

- [ ] Search script file exists and follows OpenLibrary/Google Books patterns
- [ ] Details script file exists and follows OpenLibrary/Google Books patterns
- [ ] Both scripts use `BOOKS_HARDCOVER_API_KEY` for authentication
- [ ] Both scripts properly validate inputs
- [ ] Both scripts handle errors gracefully
- [ ] seed.ts imports both scripts
- [ ] seed.ts registers both scripts with correct slugs
- [ ] seed.ts links both scripts to book entity schema
- [ ] Type checking passes
- [ ] Backend builds successfully
- [ ] All changes committed with clear messages

---

## Notes

- Scripts follow field ordering by line length convention
- Error messages are descriptive and consistent
- GraphQL queries match Rust implementation exactly
- Output contracts match OpenLibrary/Google Books exactly
- No emoji usage (per project conventions)
