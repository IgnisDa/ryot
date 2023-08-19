use anyhow::{anyhow, Result};
use async_trait::async_trait;
use convert_case::{Case, Casing};
use http_types::mime;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use surf::{http::headers::ACCEPT, Client};

use crate::{
    config::GoogleBooksConfig,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    models::{
        media::{
            BookSpecifics, MediaDetails, MediaSearchItem, MediaSpecifics, MetadataCreator,
            MetadataImage,
        },
        ApplicationImageUrl, SearchDetails, SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, get_base_http_client},
};

pub static URL: &str = "https://www.googleapis.com/books/v1/volumes/";

#[derive(Debug, Clone)]
pub struct GoogleBooksService {
    client: Client,
    page_limit: i32,
}

impl MediaProviderLanguages for GoogleBooksService {
    fn supported_languages() -> Vec<String> {
        vec!["us".to_owned()]
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl GoogleBooksService {
    pub async fn new(_config: &GoogleBooksConfig, page_limit: i32) -> Self {
        let client = get_base_http_client(URL, vec![(ACCEPT, mime::JSON)]);
        Self { client, page_limit }
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ImageLinks {
    extra_large: Option<String>,
    large: Option<String>,
    medium: Option<String>,
    small: Option<String>,
    small_thumbnail: Option<String>,
    thumbnail: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ItemVolumeInfo {
    title: String,
    published_date: Option<String>,
    image_links: Option<ImageLinks>,
    description: Option<String>,
    authors: Option<Vec<String>>,
    publisher: Option<String>,
    main_category: Option<String>,
    categories: Option<Vec<String>>,
    page_count: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ItemResponse {
    id: String,
    volume_info: ItemVolumeInfo,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    total_items: i32,
    items: Option<Vec<ItemResponse>>,
}

#[async_trait]
impl MediaProvider for GoogleBooksService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let mut rsp = self.client.get(identifier).await.map_err(|e| anyhow!(e))?;
        let data: ItemResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let d = self.google_books_response_to_search_response(data.volume_info, data.id);
        Ok(d)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let index = (page - 1) * self.page_limit;
        let mut rsp = self
            .client
            .get("")
            .query(&serde_json::json!({
                "q": format!("intitle:{}", query),
                "maxResults": self.page_limit,
                "printType": "books",
                "startIndex": index
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .items
            .unwrap_or_default()
            .into_iter()
            .map(|b| {
                let MediaDetails {
                    identifier,
                    title,
                    images,
                    publish_year,
                    ..
                } = self.google_books_response_to_search_response(b.volume_info, b.id);
                let image = images
                    .into_iter()
                    .map(|i| match i.url {
                        ApplicationImageUrl::S3(_u) => unreachable!(),
                        ApplicationImageUrl::Url(u) => u,
                    })
                    .collect_vec()
                    .get(0)
                    .cloned();
                MediaSearchItem {
                    identifier,
                    title,
                    image,
                    publish_year,
                }
            })
            .collect();
        let next_page = if search.total_items - ((page) * self.page_limit) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                total: search.total_items,
                next_page,
            },
            items: resp,
        })
    }
}
impl GoogleBooksService {
    fn google_books_response_to_search_response(
        &self,
        item: ItemVolumeInfo,
        id: String,
    ) -> MediaDetails {
        let mut images = vec![];
        if let Some(il) = item.image_links {
            if let Some(a) = il.thumbnail {
                images.push(a);
            }
            if let Some(a) = il.small_thumbnail {
                images.push(a);
            }
            if let Some(a) = il.small {
                images.push(a);
            }
            if let Some(a) = il.medium {
                images.push(a);
            }
            if let Some(a) = il.large {
                images.push(a);
            }
            if let Some(a) = il.extra_large {
                images.push(a);
            }
        };
        let images = images.into_iter().map(|a| MetadataImage {
            url: ApplicationImageUrl::Url(a),
            lot: MetadataImageLot::Poster,
        });
        let mut creators = item
            .authors
            .unwrap_or_default()
            .into_iter()
            .map(|a| MetadataCreator {
                name: a,
                role: "Author".to_owned(),
                image: None,
            })
            .collect_vec();
        if let Some(p) = item.publisher {
            creators.push(MetadataCreator {
                name: p,
                role: "Publisher".to_owned(),
                image: None,
            });
        }
        let mut genres = item
            .categories
            .unwrap_or_default()
            .into_iter()
            .flat_map(|c| c.split(" / ").map(|g| g.to_case(Case::Title)).collect_vec())
            .collect_vec();
        if let Some(g) = item.main_category {
            genres.push(g);
        }
        MediaDetails {
            identifier: id,
            lot: MetadataLot::Book,
            source: MetadataSource::GoogleBooks,
            production_status: "Released".to_owned(),
            title: item.title,
            description: item.description,
            creators: creators.into_iter().unique().collect(),
            genres: genres.into_iter().unique().collect(),
            publish_year: item.published_date.and_then(|d| convert_date_to_year(&d)),
            publish_date: None,
            specifics: MediaSpecifics::Book(BookSpecifics {
                pages: item.page_count,
            }),
            images: images.unique().collect(),
        }
    }
}
