# Importing

Importing is meant to be a one-time operation. They are irreversible, i.e., importing from
the same source twice will create duplicates. I recommend you to make a database backup
before starting an import.

An import can fail at various steps. Ryot creates a report when an import completes/fails.
You can see the reports under "Import History" of the imports page.

## Notes

- Imports are very difficult to have 100% success rate. Though we try our best,
  you might have to manually import some data from your previous provider.
- Imports might take a long time since Ryot needs to fetch all metadata from the sources
  before it can start importing progress. Estimated finish time is displayed in the UI.
- I recommend turning on debug logging for the duration of the import using the
  `RUST_LOG=ryot=debug` environment variable. This will help you help you see import
  progress in the docker logs.
