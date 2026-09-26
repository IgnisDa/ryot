# Importing

Open **Settings > Import data** to start an import.

::: warning
Imports are one-time operations. A repeated import can create duplicates. Make a
[whole-server backup](../backups.md#whole-server-backups) first.
:::

## Limitations

- Most imports add completed items only. Use an [integration](../integrations/overview.md) or update
  progress manually for in-progress items.
- Provider data cannot always be matched. Review the report after the import and add failed items
  manually.
- Metadata requests can make large imports slow. The UI shows an estimated finish time.
- Set `SERVER_LOG_LEVEL=debug` temporarily to show import progress in file or OTLP logs.

::: danger
Resetting user data can recover from a bad import, but it permanently deletes all data for that
user.
:::
