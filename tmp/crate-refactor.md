# Importer Crate-by-Crate Refactoring Instructions

This document outlines the step-by-step process for refactoring importer modules into dedicated crates.

## Pattern Overview

We are refactoring importers from module files (`crates/services/importer/src/<name>.rs`) into dedicated crates (`crates/services/importer/<name>/`). This improves code organization, makes dependencies explicit, and follows the established pattern for importer services.

## Completed Importers

- ✅ anilist
- ✅ audiobookshelf
- ✅ generic-json
- ✅ goodreads

## Remaining Importers

- [ ] grouvee
- [ ] hardcover
- [ ] hevy
- [ ] igdb
- [ ] imdb
- [ ] jellyfin
- [ ] mediatracker
- [ ] movary
- [ ] myanimelist
- [ ] netflix
- [ ] open_scale
- [ ] plex
- [ ] storygraph
- [ ] strong_app
- [ ] trakt
- [ ] watcharr

## Refactoring Steps

For each importer (e.g., `<name>`), follow these steps:

### 1. Copy Template Structure

Copy an existing importer crate as a template (anilist is a good choice):

```bash
cp -r crates/services/importer/anilist crates/services/importer/<name>
```

### 2. Move Module File

Move the existing module file to the new crate's lib.rs:

```bash
mv crates/services/importer/src/<name>.rs crates/services/importer/<name>/src/lib.rs
```

### 3. Update Crate Name

Edit `crates/services/importer/<name>/Cargo.toml` and change the package name:

```toml
[package]
name = "<name>-importer-service"
version = "0.1.0"
edition = "2024"
```

### 4. Register in Workspace

Edit the root `Cargo.toml`:

**a) Add to workspace members:**

Find the section with other importer services and add:
```toml
"crates/services/importer/<name>",
```

**b) Add to workspace dependencies:**

Find the section with other importer services and add:
```toml
<name>-importer-service = { path = "crates/services/importer/<name>" }
```

### 5. Add Dependency to Importer Service

Edit `crates/services/importer/Cargo.toml` and add the new crate as a dependency:

```toml
<name>-importer-service = { workspace = true }
```

### 6. Update Imports in lib.rs

Edit the new `crates/services/importer/<name>/src/lib.rs`:

**Replace:**
```rust
use crate::{ImportFailStep, ImportFailedItem};
```

**With:**
```rust
use importer_models::{ImportFailStep, ImportFailedItem};
```

### 7. Update Main Importer Service

Edit `crates/services/importer/src/lib.rs`:

**a) Remove the module declaration:**
```rust
mod <name>;  // DELETE this line
```

**b) Update the import call in the `perform_import` method:**

**Replace:**
```rust
ImportSource::<Name> => {
    <name>::import(...)
    .await
}
```

**With:**
```rust
ImportSource::<Name> => {
    <name>_importer_service::import(...)
    .await
}
```

### 8. Run Cargo Clippy

Check for errors and fix any issues:

```bash
cargo clippy
```

Common issues to fix:
- Missing imports in the new lib.rs
- Incorrect function signatures
- Unused dependencies in Cargo.toml

### 9. Commit Changes

Once clippy passes, commit the changes:

```bash
git add -A
git commit -m "feat: break <name> into separate importer

This change refactors the <Name> importer from a module file into a
dedicated crate, following the same pattern as anilist, audiobookshelf,
and generic-json importers.

The refactoring improves code organization and maintainability by:
- Isolating the <Name> importer logic into its own crate
- Making dependencies explicit at the crate level
- Following the established pattern for importer services
- Allowing independent compilation and testing of the importer

Changes made:
- Created new crate at crates/services/importer/<name>
- Moved <name>.rs to <name>/src/lib.rs
- Updated Cargo.toml workspace members and dependencies
- Fixed imports to use importer_models instead of crate:: references
- Updated importer service to use <name>_importer_service::import

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
"
```

## Example: Goodreads Refactoring

Here's a concrete example of the refactoring for the Goodreads importer:

**1. Copy template:**
```bash
cp -r crates/services/importer/anilist crates/services/importer/goodreads
```

**2. Move file:**
```bash
mv crates/services/importer/src/goodreads.rs crates/services/importer/goodreads/src/lib.rs
```

**3. Update Cargo.toml:**
Changed `name = "anilist-importer-service"` to `name = "goodreads-importer-service"`

**4. Register in workspace (root Cargo.toml):**
- Added `"crates/services/importer/goodreads",` to members
- Added `goodreads-importer-service = { path = "crates/services/importer/goodreads" }` to dependencies

**5. Add to importer service (crates/services/importer/Cargo.toml):**
Added `goodreads-importer-service = { workspace = true }`

**6. Fix imports in lib.rs:**
Changed `use crate::{ImportFailStep, ImportFailedItem};` to `use importer_models::{ImportFailStep, ImportFailedItem};`

**7. Update lib.rs in importer service:**
- Removed `mod goodreads;`
- Changed `goodreads::import(...)` to `goodreads_importer_service::import(...)`

**8. Run cargo clippy:**
All checks passed ✅

## Tips

- Always quote paths in bash commands since they often contain special characters
- Use the anilist or goodreads crate as a reference when unsure about dependencies
- The main importer service (crates/services/importer/src/lib.rs) contains the import routing logic
- Each importer should export a public `async fn import(...)` function
- Dependencies should be kept in sync with the template crate unless the specific importer needs additional ones

## Notes

- We do not have down migrations since we always roll forward
- Keep code files below 500 lines where possible
- Run clippy generously to catch issues early
- Commit after each successful refactoring to maintain clean history
