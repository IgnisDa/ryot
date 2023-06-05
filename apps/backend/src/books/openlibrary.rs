use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::OpenlibraryConfig,
    graphql::{AUTHOR, PROJECT_NAME},
    media::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl, PAGE_LIMIT,
    },
    migrator::{BookSource, MetadataImageLot, MetadataLot},
    traits::MediaProvider,
    utils::{get_data_parallelly_from_sources, openlibrary},
};

use super::BookSpecifics;

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
pub struct BookSearchResults {
    pub total: i32,
    pub items: Vec<BookSearchItem>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct BookSearchItem {
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub author_names: Vec<String>,
    pub genres: Vec<String>,
    pub images: Vec<String>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub book_specifics: BookSpecifics,
}

#[derive(Debug, Clone)]
pub struct OpenlibraryService {
    image_url: String,
    image_size: String,
    client: Client,
}

impl OpenlibraryService {
    pub fn new(config: &OpenlibraryConfig) -> Self {
        let client: Client = Config::new()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .set_base_url(Url::parse(&config.url).unwrap())
            .try_into()
            .unwrap();
        Self {
            image_url: config.cover_image_url.to_owned(),
            image_size: config.cover_image_size.to_string(),
            client,
        }
    }
}

#[async_trait]
impl MediaProvider for OpenlibraryService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct OpenlibraryKey {
            key: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct OpenlibraryAuthor {
            author: OpenlibraryKey,
            #[serde(rename = "type")]
            role: Option<OpenlibraryKey>,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        #[serde(untagged)]
        enum OpenlibraryAuthorResponse {
            Flat(OpenlibraryKey),
            Nested(OpenlibraryAuthor),
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        #[serde(untagged)]
        enum OpenlibraryDescription {
            Text(String),
            Nested {
                #[serde(rename = "type")]
                key: String,
                value: String,
            },
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct OpenlibraryBook {
            key: String,
            description: Option<OpenlibraryDescription>,
            title: String,
            covers: Option<Vec<i64>>,
            authors: Option<Vec<OpenlibraryAuthorResponse>>,
            subjects: Option<Vec<String>>,
        }
        let mut rsp = self
            .client
            .get(format!("works/{}.json", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: OpenlibraryBook = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct OpenlibraryEdition {
            publish_date: Option<String>,
            number_of_pages: Option<i32>,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct OpenlibraryEditionsResponse {
            entries: Option<Vec<OpenlibraryEdition>>,
        }
        let mut rsp = self
            .client
            .get(format!("works/{}/editions.json", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let editions: OpenlibraryEditionsResponse =
            rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let entries = editions.entries.unwrap_or_default();
        let all_pages = entries
            .iter()
            .filter_map(|f| f.number_of_pages)
            .collect::<Vec<_>>();
        let num_pages = if all_pages.is_empty() {
            0
        } else {
            all_pages.iter().sum::<i32>() / all_pages.len() as i32
        };
        let first_release_date = entries
            .iter()
            .filter_map(|f| f.publish_date.clone())
            .filter_map(|f| Self::parse_date(&f))
            .min();

        #[derive(Debug, Serialize, Deserialize)]
        struct OpenlibraryAuthorPartial {
            name: String,
        }
        let authors = get_data_parallelly_from_sources(
            &data.authors.unwrap_or_default(),
            &self.client,
            |a| {
                let key = match a {
                    OpenlibraryAuthorResponse::Flat(s) => s.key.to_owned(),
                    OpenlibraryAuthorResponse::Nested(s) => s.author.key.to_owned(),
                };
                format!("{}.json", key)
            },
        )
        .await
        .into_iter()
        .map(|a: OpenlibraryAuthorPartial| MetadataCreator {
            name: a.name,
            // FIXME: Use correct role
            role: "Author".to_owned(),
            image_urls: vec![],
        })
        .collect();
        let description = data.description.map(|d| match d {
            OpenlibraryDescription::Text(s) => s,
            OpenlibraryDescription::Nested { value, .. } => value,
        });
        let images = data
            .covers
            .unwrap_or_default()
            .into_iter()
            .map(|c| MetadataImage {
                url: MetadataImageUrl::Url(self.get_cover_image_url(c)),
                lot: MetadataImageLot::Poster,
            })
            .collect();
        Ok(MediaDetails {
            identifier: openlibrary::get_key(&data.key),
            title: data.title,
            description,
            lot: MetadataLot::Book,
            creators: authors,
            genres: data.subjects.unwrap_or_default(),
            images,
            publish_year: first_release_date.map(|d| d.year()),
            publish_date: None,
            specifics: MediaSpecifics::Book(BookSpecifics {
                pages: Some(num_pages),
                source: BookSource::OpenLibrary,
            }),
        })
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct OpenlibraryBook {
            key: String,
            title: String,
            author_name: Option<Vec<String>>,
            cover_i: Option<i64>,
            publish_year: Option<Vec<i32>>,
            first_publish_year: Option<i32>,
            number_of_pages_median: Option<i32>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct OpenLibrarySearchResponse {
            num_found: i32,
            docs: Vec<OpenlibraryBook>,
        }
        let fields = [
            "key",
            "title",
            "author_name",
            "cover_i",
            "first_publish_year",
        ]
        .join(",");
        let mut rsp = self
            .client
            .get("search.json")
            .query(&json!({
                "q": query.to_owned(),
                "fields": fields,
                "offset": (page.unwrap_or_default() - 1) * PAGE_LIMIT,
                "limit": PAGE_LIMIT,
                "type": "work".to_owned(),
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: OpenLibrarySearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .docs
            .into_iter()
            .map(|d| {
                let images = Vec::from_iter(d.cover_i.map(|f| self.get_cover_image_url(f)));
                BookSearchItem {
                    identifier: openlibrary::get_key(&d.key),
                    title: d.title,
                    description: None,
                    author_names: d.author_name.unwrap_or_default(),
                    genres: vec![],
                    publish_year: d.first_publish_year,
                    publish_date: None,
                    book_specifics: BookSpecifics {
                        pages: d.number_of_pages_median,
                        source: BookSource::OpenLibrary,
                    },
                    images,
                }
            })
            .collect::<Vec<_>>();
        let data = BookSearchResults {
            total: search.num_found,
            items: resp,
        };
        Ok(MediaSearchResults {
            total: data.total,
            items: data
                .items
                .into_iter()
                .map(|b| MediaSearchItem {
                    identifier: b.identifier,
                    lot: MetadataLot::Book,
                    title: b.title,
                    images: b.images,
                    publish_year: b.publish_year,
                })
                .collect(),
        })
    }
}

impl OpenlibraryService {
    fn get_cover_image_url(&self, c: i64) -> String {
        format!(
            "{}/id/{}-{}.jpg?default=false",
            self.image_url, c, self.image_size
        )
    }

    fn parse_date(input: &str) -> Option<NaiveDate> {
        let formats = ["%b %d, %Y", "%Y", "%b %d, %Y"];
        for format in formats.iter() {
            if let Ok(date) = NaiveDate::parse_from_str(input, format) {
                return Some(date);
            }
        }
        None
    }
}
