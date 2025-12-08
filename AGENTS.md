# Rules for Ryot

- Use tools from the Serena MCP (if available) to help you with faster code navigation
  and retrieval. It supports Rust and Typescript.
- The project uses `moon` for monorepo management. All frontend-related commands (like type
  checking, running tests, etc.) should use `moon` commands.
- You can read @apps/docs/src/contributing.md for an overview of the project architecture
  and some common commands.
- When running bash commands (`git`, `sed`), please remember to quote the paths using
  single quotes since they often contain special characters.
- When getting data from GitHub, try using the `gh` CLI and make raw requests only when
  absolutely necessary.
- When making changes to the code, run the following commands often to ensure that the
  changes you are making do not break anything:

  ```bash
  cargo clippy
  moon run docs:build
  moon run tests:typecheck
  moon run website:typecheck
  moon run frontend:typecheck
  moon run browser-extension:typecheck
  ```

- When running tests, implement the feature first and compile the backend in release mode,
  then always ask the user's approval before executing tests to save iteration time.
- After adding a GraphQL query or mutation to the backend, run `moon run
  generated:backend-graphql` so that the frontend can use the new query or mutation.
  Beforehand, ensure the backend server is running (in debug mode) in the background,
  and stop it after the generation completes.
- Do not add code comments unless strictly necessary.
- Since this is an open-source project, we have a slightly different approach to writing
  migrations. When adding a migration with a schema change, if the table you are working
  with already exists, then the same change should be applied to the migration where this
  table was first created. We need to do this so that new instances of Ryot can have the
  same table structure right off the bat.
- The migration files should be named `m<YYYYMMDD>_changes_for_issue_<number>`. Read other
  migration files for examples.
- We do not have down migrations since we always roll forward. It should just be an empty
  block with `Ok(())`.
- We try to keep the code files below 500 lines. If a file is larger than that, consider
  splitting it into smaller files (using functions, components, etc.) to improve
  readability.
- React components should use a single `props` parameter instead of destructured props in
  function arguments. Use `props.propertyName` syntax rather than destructuring
  `{ propertyName }` in the function signature.
- When asked to create a git commit, read all the dirty changes in the repository and then
  create logical commits, grouping related changes together. Create multiple commits as
  needed. Commit messages should be verbose and explain the reasoning behind the changes,
  not just what was changed.
