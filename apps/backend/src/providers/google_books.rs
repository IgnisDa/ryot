use anyhow::{anyhow, Result};
use async_trait::async_trait;
use convert_case::{Case, Casing};
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use surf::{Client, Url};

use crate::{
    config::GoogleBooksConfig,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    miscellaneous::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl, PAGE_LIMIT,
    },
    models::media::BookSpecifics,
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, get_base_http_client_config},
};

pub static URL: &str = "https://www.googleapis.com/books/v1/volumes/";

#[derive(Debug, Clone)]
pub struct GoogleBooksService {
    client: Client,
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
    pub async fn new(_config: &GoogleBooksConfig) -> Self {
        let client = get_base_http_client_config()
            .set_base_url(Url::parse(URL).unwrap())
            .try_into()
            .unwrap();
        Self { client }
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

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        let index = (page - 1) * PAGE_LIMIT;
        let mut rsp = self
            .client
            .get("")
            .query(&serde_json::json!({
                "q": format!("intitle:{}", query),
                "maxResults": PAGE_LIMIT,
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
                    lot,
                    images,
                    publish_year,
                    ..
                } = self.google_books_response_to_search_response(b.volume_info, b.id);
                let images = images
                    .into_iter()
                    .map(|i| match i.url {
                        MetadataImageUrl::S3(_u) => unreachable!(),
                        MetadataImageUrl::Url(u) => u,
                    })
                    .collect();
                MediaSearchItem {
                    identifier,
                    lot,
                    title,
                    images,
                    publish_year,
                }
            })
            .collect();
        let next_page = if search.total_items - ((page) * PAGE_LIMIT) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(MediaSearchResults {
            total: search.total_items,
            items: resp,
            next_page,
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
            url: MetadataImageUrl::Url(a),
            lot: MetadataImageLot::Poster,
        });
        let mut creators = item
            .authors
            .unwrap_or_default()
            .into_iter()
            .map(|a| MetadataCreator {
                name: a,
                role: "Author".to_owned(),
                image_urls: vec![],
            })
            .collect::<Vec<_>>();
        if let Some(p) = item.publisher {
            creators.push(MetadataCreator {
                name: p,
                role: "Publisher".to_owned(),
                image_urls: vec![],
            });
        }
        let mut genres = item
            .categories
            .unwrap_or_default()
            .into_iter()
            .flat_map(|c| {
                c.split(" / ")
                    .map(|g| g.to_case(Case::Title))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        if let Some(g) = item.main_category {
            genres.push(g);
        }
        MediaDetails {
            identifier: id,
            lot: MetadataLot::Book,
            source: MetadataSource::GoogleBooks,
            title: item.title,
            description: item.description,
            creators: creators.into_iter().unique().collect(),
            genres: genres.into_iter().unique().collect(),
            publish_year: item
                .published_date
                .and_then(|d| convert_date_to_year(&d)),
            publish_date: None,
            specifics: MediaSpecifics::Book(BookSpecifics {
                pages: item.page_count,
            }),
            images: images.unique().collect(),
        }
    }
}
