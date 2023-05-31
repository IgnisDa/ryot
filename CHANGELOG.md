
# Version 1.0.0-beta.36 (2023-05-31)

## Bug Fixes

* **backend:** mask database url
* **backend:** handle error while updating metadata
* **frontend:** spoiler check-box initial value in review
* **frontend:** display genres correctly
* **frontend:** update creators for metadata
* **frontend:** enable strict mode in slugify

## Build

* **backend:** bump version
* **backend:** add rate limiting deps
* **backend:** bump version

## Features

* **backend:** write tmdb config to file
* **backend:** get creator information from sources
* **backend:** migration to delete creator tables
* **backend:** embed creators in metadata
* **backend:** get author role from response
* **backend:** deploy jobs to update all metadata
* **backend:** handle getting details from goodreads
* **backend:** add mutation to deploy a job to update all metadata
* **frontend:** new UI for media details
* **frontend:** humanize duration
* **frontend:** display runtime for episodes
* **frontend:** add btn to deploy jobs to update all metadata

## Performance Improvements

* **backend:** rate limit update metadata jobs


# Version 1.0.0-beta.35 (2023-05-31)

## Documentation

* fix incorrect docker command
* change example config
* remove docker-compose example
* remove data about example file


# Version 1.0.0-beta.34 (2023-05-30)

## Bug Fixes

* **frontend:** handle edge cases for progress modal

## Build

* **backend:** bump version


# Version 1.0.0-beta.33 (2023-05-30)

## Bug Fixes

* **frontend:** redirect to correct page for review edit

## Build

* **backend:** bump version


# Version 1.0.0-beta.32 (2023-05-30)

## Build

* **backend:** bump version
* **backend:** update dependencies


# Version 1.0.0-beta.31 (2023-05-30)


# Version 1.0.0-beta.30 (2023-05-29)

## Documentation

* add information about changelog


# Version 1.0.0-beta.29 (2023-05-29)


# Version 1.0.0-beta.28 (2023-05-29)


# Version 1.0.0-beta.27 (2023-05-29)

## Build

* **backend:** bump version

## Features

* **frontend:** ask for confirmation before deleting collection


# Version 1.0.0-beta.26 (2023-05-29)


# Version 1.0.0-beta.25 (2023-05-29)


# Version 1.0.0-beta.24 (2023-05-29)


# Version 1.0.0-beta.23 (2023-05-28)

## Documentation

* add info about quick release


# Version 1.0.0-beta.22 (2023-05-28)


# Version 1.0.0-beta.21 (2023-05-28)

## Build

* **backend:** bump dependencies


# Version 1.0.0-beta.20 (2023-05-28)


# Version 1.0.0-beta.19 (2023-05-27)

## Bug Fixes

* **frontend:** use correct path for routes

## Build

* **backend:** bump version


# Version 1.0.0-beta.18 (2023-05-27)

## Bug Fixes

* **backend:** use correct connection string

## Build

* **backend:** bump version


# Version 1.0.0-beta.17 (2023-05-27)

## Build

* **backend:** bump version


# Version 1.0.0-beta.16 (2023-05-27)

## Build

* **backend:** bump dependencies


# Version 1.0.0-beta.15 (2023-05-27)


# Version 1.0.0-beta.14 (2023-05-27)


# Version 1.0.0-beta.13 (2023-05-27)

## Bug Fixes

* **backend:** unwrap with default

## Build

* **backend:** bump version


# Version 1.0.0-beta.12 (2023-05-26)

## Documentation

* remove screenshots


# Version 1.0.0-beta.11 (2023-05-26)

## Build

* **backend:** bump version


# Version 1.0.0-beta.10 (2023-05-25)


# Version 1.0.0-beta.9 (2023-05-25)

## Bug Fixes

* **frontend:** client side error when trimming query

## Build

* **backend:** bump version

## Documentation

* update dashboard screenshot
* remove ref to goodreads rss url


# Version 1.0.0-beta.8 (2023-05-25)

## Bug Fixes

* **backend:** wrong history for goodreads books

## Build

* **backend:** bump version

## Features

* accept RSS url for goodreads


# Version 1.0.0-beta.7 (2023-05-25)

## Bug Fixes

* **frontend:** do not highlight time in summary

## Build

* **backend:** bump version


# Version 1.0.0-beta.6 (2023-05-25)

## Build

* **backend:** bump version


# Version 1.0.0-beta.5 (2023-05-25)

## Bug Fixes

* **backend:** do not deploy summary job when seen deleted

## Build

* **backend:** bump version

## Features

* **backend:** delete media from "In Progress" when it's seen item is deleted


# Version 1.0.0-beta.4 (2023-05-24)


# Version 1.0.0-beta.3 (2023-05-23)

## Build

* **backend:** bump version

## Features

* **frontend:** allow clearing search input


# Version 1.0.0-beta-2 (2023-05-22)

## Bug Fixes

* **frontend:** layout issues for mine tab in list page

## Build

* **backend:** bump version


# Version 1.0.0-beta.1 (2023-05-22)

## Bug Fixes

* **backend:** calculate watched shows efficiently


# Version 0.0.45 (2023-05-21)

## Bug Fixes

* display correct num of shows

## Build

* **backend:** bump version


# Version 0.0.44 (2023-05-21)

## Bug Fixes

* **backend:** correct calculation for shows and episodes summary
* **frontend:** remove useless click operation

## Build

* **backend:** bump version

## Features

* do not display num shows on dashboard summary
* store summary in json
* display num show seasons and podcast episodes
* **backend:** store podcast episodes played in db
* **backend:** make season summary more explicit


# Version 0.0.43 (2023-05-21)


# Version 0.0.42 (2023-05-21)

## Build

* **backend:** bump version

## Features

* **frontend:** make password validation stronger


# Version 0.0.41 (2023-05-21)

## Bug Fixes

* **frontend:** do not display "In Progress" if empty

## Build

* **backend:** bump version

## Features

* **backend:** remove `identifier` field from models


# Version 0.0.40 (2023-05-21)

## Bug Fixes

* **frontend:** add title tag to collections page

## Build

* **backend:** bump version

## Features

* **backend:** remove useless migrations


# Version 0.0.39 (2023-05-20)


# Version 0.0.38 (2023-05-20)

## Build

* **backend:** bump version

## Features

* **backend:** store identifier in metadata tbl


# Version 0.0.37 (2023-05-19)

## Bug Fixes

* **backend:** use correct query for full text search

## Build

* **backend:** bump version


# Version 0.0.36 (2023-05-19)

## Build

* **backend:** bump version

## Features

* display repo link on footer


# Version 0.0.35 (2023-05-19)

## Build

* **backend:** bump version

## Features

* **frontend:** add separate collections page


# Version 0.0.34 (2023-05-18)

## Build

* **backend:** bump version

## Documentation

* change ryot logo

## Features

* **frontend:** remove PWA related stuff


# Version 0.0.33 (2023-05-18)


# Version 0.0.32 (2023-05-18)

## Build

* **backend:** bump version

## Features

* **frontend:** add page title


# Version 0.0.31 (2023-05-18)

## Build

* **backend:** bump version


# Version 0.0.30 (2023-05-18)

## Build

* **backend:** bump version
* **backend:** remove useless dependency

## Features

* **backend:** use correct database for scheduler


# Version 0.0.29 (2023-05-18)

## Features

* **ci:** enable sea orm info logs in prod build


# Version 0.0.28 (2023-05-18)


# Version 0.0.27 (2023-05-15)

## Bug Fixes

* **backend:** store import error string in database

## Build

* **backend:** bump version


# Version 0.0.26 (2023-05-15)

## Bug Fixes

* **backend:** allow listennotes init to fail

## Build

* **backend:** bump version


# Version 0.0.25 (2023-05-15)

## Bug Fixes

* **backend:** deploy summary job only when import complete

## Build

* **backend:** bump version


# Version 0.0.24 (2023-05-15)


# Version 0.0.23 (2023-05-15)

## Bug Fixes

* **backend:** import Goodreads books from MediaTracker

## Build

* **backend:** bump version


# Version 0.0.22 (2023-05-14)

## Bug Fixes

* **backend:** parse correct date from media tracker

## Build

* **backend:** bump version


# Version 0.0.21 (2023-05-14)

## Bug Fixes

* **backend:** do not bail out when getting details

## Build

* **backend:** bump version

## Documentation

* add example for insecure cookie


# Version 0.0.20 (2023-05-13)

## Bug Fixes

* **backend:** add expires token to cookie created

## Build

* **backend:** bump version

## Documentation

* add ELI5 section

## Features

* **backend:** allow setting insecure cookies


# Version 0.0.19 (2023-05-13)

## Bug Fixes

* **backend:** use redirects in openlibrary http client


# Version 0.0.18 (2023-05-12)

## Bug Fixes

* **backend:** use redirects in openlibrary http client

## Build

* **backend:** update dependencies

## Documentation

* make features clearer


# Version 0.0.17 (2023-05-12)

## Bug Fixes

* **backend:** remove useless dbg stmt
* **backend:** log when a import job starts up

## Build

* **backend:** bump version

## Documentation

* allow updating app from script
* add deployment guide
* fix incorrect paths in guide
* add information about project

## Features

* **backend:** load only `database.url` from environment
* **frontend:** use correct default values for form


# Version 0.0.16 (2023-05-11)


# Version 0.0.15 (2023-05-10)


# Version 0.0.14 (2023-05-10)


# Version 0.0.13 (2023-05-07)

## Bug Fixes

* **frontend:** make rating text optional

## Build

* **backend:** bump version

## Features

* **frontend:** increase scale on hover


# Version 0.0.12 (2023-05-07)


# Version 0.0.11 (2023-05-07)


# Version 0.0.10 (2023-05-05)

## Bug Fixes

* finish renaming project

## Build

* **backend:** bump version

## Features

* rename project


# Version 0.0.9 (2023-05-05)


# Version 0.0.8 (2023-05-04)


# Version 0.0.7 (2023-05-03)

## Bug Fixes

* **backend:** use correct enum repr
* **backend:** remove useless `graphql` attribute
* **backend:** use correct data type for enum
* **backend:** use text columns to denote enums
* **backend:** correct order for migrations
* **frontend:** send correct episode number as cmd
* **frontend:** refresh list

## Features

* **backend:** add endpoint to get user details
* **backend:** use correct data types for date columns
* **frontend:** redirect to auth page on invalid token
* **frontend:** show overlay when loading


# Version 0.0.6 (2023-05-03)

## Bug Fixes

* **frontend:** use correct casing for words

## Features

* **frontend:** add link to self website


# Version 0.0.5 (2023-05-02)


# Version 0.0.4 (2023-05-01)

## Build

* **backend:** bump version


# Version 0.0.3 (2023-04-25)

## Bug Fixes

* **backend:** only display trace messages on bg job
* **backend:** load port from env var
* **frontend:** allow dynamic hostname


# Version 0.0.2 (2023-04-25)

## Documentation

* mention project status


# Version 0.0.1 (2023-04-25)

## Bug Fixes

* **ci:** use correct tag name
* **frontend:** use correct package name

## Build

* ensure static linking
* **app:** update tailwindcss

## Features

* initial commit
* **app:** make layout better
* **app:** add basic data fetching
* **app:** add nextjs app
* **app:** add basic application
* **app:** enable static generation
* **app:** add basic pages
* **backend:** add project config struct
* **backend:** allow displaying nested routes
* **backend:** add basic axum application
* **backend:** use correct embed route
* **backend:** add initial migration code
* **backend:** handle outputs from nextjs export
* **frontend:** add basic project
* **frontend:** add basic about page

