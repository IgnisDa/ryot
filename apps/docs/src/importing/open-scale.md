# Open Scale

1. In [openScale](https://github.com/oliexdev/openScale), open the top-right menu and select
   **Export**.
2. Upload the saved CSV file under **Settings > Import data**.
3. Select the timezone used when the measurements were recorded. Timestamps with an explicit UTC
   offset keep that offset instead.

Times skipped by a daylight-saving change are reported as invalid. If a local time occurs twice,
the earlier occurrence is used; include a UTC offset in the CSV to select the other one.
