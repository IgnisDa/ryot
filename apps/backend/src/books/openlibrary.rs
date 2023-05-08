use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::OpenlibraryConfig,
    graphql::AUTHOR,
    media::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        LIMIT,
    },
    migrator::MetadataLot,
    utils::{convert_option_path_to_vec, get_data_parallely_from_sources},
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
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
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
        let client = Config::new()
            .add_header(USER_AGENT, format!("{}/ryot", AUTHOR))
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

impl OpenlibraryService {
    fn get_key(key: &str) -> String {
        key.split('/')
            .collect::<Vec<_>>()
            .last()
            .cloned()
            .unwrap()
            .to_owned()
    }

    // FIXME: We are calling internal search because the number of pages is not
    // available on the work detail. We need a smarter way to do it so that we
    // can extract traits for these providers.
    pub async fn details(
        &self,
        identifier: &str,
        query: &str,
        offset: Option<i32>,
        index: i32,
    ) -> Result<MediaDetails<BookSpecifics>> {
        let mut d = self.search_internal(query, offset).await?.items[index as usize].clone();
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct OpenlibraryKey {
            key: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct OpenlibraryAuthor {
            author: OpenlibraryKey,
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
            description: Option<OpenlibraryDescription>,
            covers: Option<Vec<i64>>,
            authors: Vec<OpenlibraryAuthor>,
            subjects: Vec<String>,
        }
        let mut rsp = self
            .client
            .get(format!("works/{}.json", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: OpenlibraryBook = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        #[derive(Debug, Serialize, Deserialize)]
        struct OpenlibraryAuthorPartial {
            name: String,
        }
        let authors = get_data_parallely_from_sources(&data.authors, &self.client, |a| {
            format!("{}.json", a.author.key)
        })
        .await
        .into_iter()
        .map(|a: OpenlibraryAuthorPartial| a.name)
        .collect();
        d.description = data.description.map(|d| match d {
            OpenlibraryDescription::Text(s) => s,
            OpenlibraryDescription::Nested { value, .. } => value,
        });
        d.poster_images = data
            .covers
            .unwrap_or_default()
            .into_iter()
            .map(|c| self.get_cover_image_url(c))
            .collect();
        d.author_names = authors;
        d.genres = data.subjects;
        Ok(MediaDetails {
            identifier: d.identifier,
            title: d.title,
            description: d.description,
            lot: MetadataLot::Book,
            creators: d.author_names,
            genres: d.genres,
            poster_images: d.poster_images,
            backdrop_images: d.backdrop_images,
            publish_year: d.publish_year,
            publish_date: d.publish_date,
            specifics: d.book_specifics,
        })
    }

    pub async fn search(&self, query: &str, offset: Option<i32>) -> Result<MediaSearchResults> {
        let data = self.search_internal(query, offset).await?;
        Ok(MediaSearchResults {
            total: data.total,
            items: data
                .items
                .into_iter()
                .map(|b| MediaSearchItem {
                    identifier: b.identifier,
                    lot: MetadataLot::Book,
                    title: b.title,
                    poster_images: b.poster_images,
                    publish_year: b.publish_year,
                })
                .collect(),
        })
    }

    async fn search_internal(&self, query: &str, offset: Option<i32>) -> Result<BookSearchResults> {
        #[derive(Serialize, Deserialize)]
        struct Query {
            q: String,
            fields: String,
            offset: i32,
            limit: i32,
            #[serde(rename = "type")]
            lot: String,
        }
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

        let mut rsp = self
            .client
            .get("search.json")
            .query(&Query {
                q: query.to_owned(),
                fields: [
                    "key",
                    "title",
                    "author_name",
                    "cover_i",
                    "first_publish_year",
                    "number_of_pages_median",
                ]
                .join(","),
                offset: offset.unwrap_or_default(),
                limit: LIMIT,
                lot: "work".to_owned(),
            })
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: OpenLibrarySearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .docs
            .into_iter()
            .map(|d| {
                let poster_images =
                    convert_option_path_to_vec(d.cover_i.map(|f| self.get_cover_image_url(f)));
                BookSearchItem {
                    identifier: Self::get_key(&d.key),
                    title: d.title,
                    description: None,
                    author_names: d.author_name.unwrap_or_default(),
                    genres: vec![],
                    publish_year: d.first_publish_year,
                    publish_date: None,
                    book_specifics: BookSpecifics {
                        pages: d.number_of_pages_median,
                    },
                    poster_images,
                    backdrop_images: vec![],
                }
            })
            .collect::<Vec<_>>();
        Ok(BookSearchResults {
            total: search.num_found,
            items: resp,
        })
    }

    fn get_cover_image_url(&self, c: i64) -> String {
        format!(
            "{}/id/{}-{}.jpg?default=false",
            self.image_url, c, self.image_size
        )
    }
}
