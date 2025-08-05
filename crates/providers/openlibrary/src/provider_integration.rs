use anyhow::{Result, anyhow};
use async_trait::async_trait;
use chrono::Datelike;
use common_models::{
    EntityAssets, MetadataSearchSourceSpecifics, PersonSourceSpecifics, SearchDetails,
};
use common_utils::{PAGE_SIZE, ryot_log};
use convert_case::{Case, Casing};
use dependent_models::{PersonDetails, SearchResults};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    BookSpecifics, MetadataDetails, MetadataSearchItem, PartialMetadataPerson, PeopleSearchItem,
};
use serde_json::json;
use traits::MediaProvider;

use crate::{
    client::URL,
    models::{
        AuthorLibrarySearchResponse, BookSearchItem, BookSearchResults, Description,
        EditionsResponse, MediaLibrarySearchResponse, MetadataDetailsAuthorResponse,
        MetadataDetailsBook, OpenlibraryService, PersonDetailsAuthor,
    },
    utilities::{get_key, parse_date, parse_date_flexible},
};

#[async_trait]
impl MediaProvider for OpenlibraryService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let page = page.unwrap_or(1);
        let rsp = self
            .client
            .get(format!("{URL}/search/authors.json"))
            .query(&json!({
                "q": query.to_owned(),
                "offset": (page - 1) * PAGE_SIZE,
                "limit": PAGE_SIZE,
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: AuthorLibrarySearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .docs
            .into_iter()
            .map(|d| PeopleSearchItem {
                name: d.name,
                identifier: get_key(&d.key),
                birth_year: d.birth_date.and_then(|b| parse_date(&b)).map(|d| d.year()),
                ..Default::default()
            })
            .collect_vec();
        let data = SearchResults {
            items: resp,
            details: SearchDetails {
                total: search.num_found,
                next_page: (search.num_found - (page * PAGE_SIZE) > 0).then(|| page + 1),
            },
        };
        Ok(data)
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let rsp = self
            .client
            .get(format!("{URL}/authors/{identifier}.json"))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: PersonDetailsAuthor = rsp.json().await.map_err(|e| anyhow!(e))?;
        ryot_log!(debug, "Got person data: {:?}", data);
        let description = data.bio.map(|d| match d {
            Description::Text(s) => s,
            Description::Nested { value, .. } => value,
        });
        let images = data
            .photos
            .unwrap_or_default()
            .into_iter()
            .filter(|c| c > &0)
            .map(|c| self.get_author_cover_image_url(c))
            .unique()
            .collect();
        let source_url = data
            .links
            .unwrap_or_default()
            .first()
            .and_then(|l| l.url.clone())
            .unwrap_or_else(|| format!("https://openlibrary.org{}", data.key));
        let birth_date = data.birth_date.and_then(|d| parse_date_flexible(&d));
        let death_date = data.death_date.and_then(|d| parse_date_flexible(&d));
        Ok(PersonDetails {
            name: data.name,
            death_date,
            birth_date,
            description,
            source_url: Some(source_url),
            source: MediaSource::Openlibrary,
            identifier: get_key(&data.key),
            assets: EntityAssets {
                remote_images: images,
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .client
            .get(format!("{URL}/works/{identifier}.json"))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: MetadataDetailsBook = rsp.json().await.map_err(|e| anyhow!(e))?;
        ryot_log!(debug, "Openlibrary response: {:?}", data);

        let rsp = self
            .client
            .get(format!("{URL}/works/{identifier}/editions.json"))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let editions: EditionsResponse = rsp.json().await.map_err(|e| anyhow!(e))?;

        let num_pages = editions
            .entries
            .as_ref()
            .and_then(|e| {
                e.iter()
                    .filter_map(|e| e.number_of_pages)
                    .max_by(|a, b| a.cmp(b))
            })
            .unwrap_or_default();

        let first_release_date = editions.entries.as_ref().and_then(|entries| {
            entries
                .iter()
                .filter_map(|e| e.publish_date.as_ref())
                .filter_map(|d| parse_date_flexible(d))
                .min()
        });

        let mut people = vec![];
        for a in data.authors.iter().flatten() {
            let (key, role) = match a {
                MetadataDetailsAuthorResponse::Flat(s) => (s.key.to_owned(), "Author".to_owned()),
                MetadataDetailsAuthorResponse::Nested(s) => (
                    s.author.key.to_owned(),
                    s.role
                        .as_ref()
                        .map(|r| r.key.clone())
                        .unwrap_or_else(|| "Author".to_owned()),
                ),
            };
            people.push(PartialMetadataPerson {
                role,
                identifier: get_key(&key),
                source: MediaSource::Openlibrary,
                ..Default::default()
            });
        }
        let description = data.description.map(|d| match d {
            Description::Text(s) => s,
            Description::Nested { value, .. } => value,
        });

        let mut images = vec![];
        for c in data.covers.iter().flatten() {
            images.push(*c);
        }
        for entry in editions.entries.iter().flatten() {
            if let Some(covers) = &entry.covers {
                for c in covers {
                    images.push(*c);
                }
            }
        }

        let remote_images = images
            .into_iter()
            .filter(|c| c > &0)
            .map(|c| self.get_book_cover_image_url(c))
            .unique()
            .collect();

        let genres = data
            .subjects
            .unwrap_or_default()
            .into_iter()
            .flat_map(|s| s.split(", ").map(|d| d.to_case(Case::Title)).collect_vec())
            .collect_vec();

        let identifier = get_key(&data.key);
        Ok(MetadataDetails {
            people,
            genres,
            description,
            lot: MediaLot::Book,
            title: data.title.clone(),
            identifier: identifier.clone(),
            source: MediaSource::Openlibrary,
            publish_year: first_release_date.map(|d| d.year()),
            source_url: Some(format!(
                "https://openlibrary.org/works/{}/{}",
                identifier, data.title
            )),
            book_specifics: Some(BookSpecifics {
                pages: Some(num_pages),
                ..Default::default()
            }),
            assets: EntityAssets {
                remote_images,
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let fields = [
            "key",
            "title",
            "author_name",
            "cover_i",
            "first_publish_year",
        ]
        .join(",");
        let rsp = self
            .client
            .get(format!("{URL}/search.json"))
            .query(&json!({
                "q": query.to_owned(),
                "fields": fields,
                "offset": (page - 1) * PAGE_SIZE,
                "limit": PAGE_SIZE,
                "type": "work".to_owned(),
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: MediaLibrarySearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .docs
            .into_iter()
            .map(|d| {
                let images = Vec::from_iter(d.cover_i.map(|f| self.get_book_cover_image_url(f)));
                BookSearchItem {
                    images,
                    title: d.title,
                    identifier: get_key(&d.key),
                    publish_year: d.first_publish_year,
                    author_names: d.author_name.unwrap_or_default(),
                    ..Default::default()
                }
            })
            .collect_vec();
        let data = BookSearchResults {
            total: search.num_found,
            items: resp,
        };
        let next_page = (search.num_found - ((page) * PAGE_SIZE) > 0).then(|| page + 1);
        Ok(SearchResults {
            details: SearchDetails {
                total: data.total,
                next_page,
            },
            items: data
                .items
                .into_iter()
                .map(|b| MetadataSearchItem {
                    identifier: b.identifier,
                    title: b.title,
                    image: b.images.first().cloned(),
                    publish_year: b.publish_year,
                })
                .collect(),
        })
    }
}
