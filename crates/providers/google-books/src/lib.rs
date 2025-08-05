use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use common_models::{EntityAssets, MetadataSearchSourceSpecifics, SearchDetails};
use common_utils::{PAGE_SIZE, convert_date_to_year};
use convert_case::{Case, Casing};
use dependent_models::SearchResults;
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{BookSpecifics, MetadataDetails, MetadataFreeCreator, MetadataSearchItem};
use reqwest::{
    Client,
    header::{HeaderName, HeaderValue},
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use traits::MediaProvider;

static URL: &str = "https://www.googleapis.com/books/v1/volumes";

#[derive(Debug, Clone)]
pub struct GoogleBooksService {
    client: Client,
}

impl GoogleBooksService {
    pub async fn new(config: &config_definition::GoogleBooksConfig) -> Result<Self> {
        let client = get_base_http_client(Some(vec![(
            HeaderName::from_static("x-goog-api-key"),
            HeaderValue::from_str(&config.api_key)?,
        )]));
        Ok(Self { client })
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
    average_rating: Option<Decimal>,
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
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .client
            .get(format!("{URL}/{identifier}"))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: ItemResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let d = self.google_books_response_to_search_response(data.volume_info, data.id);
        Ok(d)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let index = (page - 1) * PAGE_SIZE;
        let rsp = self
            .client
            .get(URL)
            .query(&serde_json::json!({
                "q": match source_specifics.as_ref().and_then(|s| s.google_books_pass_raw_query).unwrap_or(false) {
                    true => query.to_owned(),
                    false => format!("intitle:{query}")
                },
                "maxResults": PAGE_SIZE,
                "printType": "books",
                "startIndex": index
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .items
            .unwrap_or_default()
            .into_iter()
            .map(|b| {
                let MetadataDetails {
                    title,
                    assets,
                    identifier,
                    publish_year,
                    ..
                } = self.google_books_response_to_search_response(b.volume_info, b.id);
                let image = assets.remote_images.first().cloned();
                MetadataSearchItem {
                    title,
                    image,
                    identifier,
                    publish_year,
                }
            })
            .collect();
        let next_page = (search.total_items - ((page) * PAGE_SIZE) > 0).then(|| page + 1);
        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total: search.total_items,
            },
        })
    }
}

impl GoogleBooksService {
    fn google_books_response_to_search_response(
        &self,
        item: ItemVolumeInfo,
        id: String,
    ) -> MetadataDetails {
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
        let remote_images = images.into_iter().unique().collect();
        let mut creators = item
            .authors
            .unwrap_or_default()
            .into_iter()
            .map(|a| MetadataFreeCreator {
                name: a,
                role: "Author".to_owned(),
                ..Default::default()
            })
            .collect_vec();
        if let Some(p) = item.publisher {
            creators.push(MetadataFreeCreator {
                name: p,
                role: "Publisher".to_owned(),
                ..Default::default()
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
        let assets = EntityAssets {
            remote_images,
            ..Default::default()
        };
        MetadataDetails {
            assets,
            lot: MediaLot::Book,
            identifier: id.clone(),
            title: item.title.clone(),
            description: item.description,
            source: MediaSource::GoogleBooks,
            provider_rating: item.average_rating,
            genres: genres.into_iter().unique().collect(),
            creators: creators.into_iter().unique().collect(),
            publish_year: item.published_date.and_then(|d| convert_date_to_year(&d)),
            book_specifics: Some(BookSpecifics {
                pages: item.page_count,
                ..Default::default()
            }),
            source_url: Some(format!(
                "https://www.google.co.in/books/edition/{}/{}",
                item.title, id
            )),
            ..Default::default()
        }
    }

    /// Get a book's ID from its ISBN
    pub async fn id_from_isbn(&self, isbn: &str) -> Option<String> {
        let resp = self
            .client
            .get(URL)
            .query(&serde_json::json!({ "q": format!("isbn:{}", isbn) }))
            .send()
            .await
            .ok()?;
        let search: SearchResponse = resp.json().await.ok()?;
        Some(search.items?.first()?.id.clone())
    }
}
