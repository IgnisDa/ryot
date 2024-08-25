use anyhow::{anyhow, Result};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use common_models::SearchDetails;
use common_utils::convert_date_to_year;
use convert_case::{Case, Casing};
use dependent_models::SearchResults;
use enums::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    BookSpecifics, MediaDetails, MetadataFreeCreator, MetadataImageForMediaDetails,
    MetadataSearchItem,
};
use reqwest::{
    header::{HeaderName, HeaderValue},
    Client,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use traits::{MediaProvider, MediaProviderLanguages};

static URL: &str = "https://www.googleapis.com/books/v1/volumes";

#[derive(Debug, Clone)]
pub struct GoogleBooksService {
    client: Client,
    page_limit: i32,
    pass_raw_query: bool,
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
    pub async fn new(config: &config::GoogleBooksConfig, page_limit: i32) -> Self {
        let client = get_base_http_client(Some(vec![(
            HeaderName::from_static("x-goog-api-key"),
            HeaderValue::from_str(&config.api_key).unwrap(),
        )]));
        Self {
            client,
            page_limit,
            pass_raw_query: config.pass_raw_query,
        }
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
    async fn metadata_details(&self, identifier: &str) -> Result<MediaDetails> {
        let rsp = self
            .client
            .get(format!("{}/{}", URL, identifier))
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
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let index = (page - 1) * self.page_limit;
        let rsp = self
            .client
            .get(URL)
            .query(&serde_json::json!({
                "q": match self.pass_raw_query {
                    true => query.to_owned(),
                    false => format!("intitle:{}", query)
                },
                "maxResults": self.page_limit,
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
                let MediaDetails {
                    identifier,
                    title,
                    url_images,
                    publish_year,
                    ..
                } = self.google_books_response_to_search_response(b.volume_info, b.id);
                let image = url_images.first().map(|i| i.image.clone());
                MetadataSearchItem {
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
        let images = images
            .into_iter()
            .map(|a| MetadataImageForMediaDetails { image: a });
        let mut creators = item
            .authors
            .unwrap_or_default()
            .into_iter()
            .map(|a| MetadataFreeCreator {
                name: a,
                role: "Author".to_owned(),
                image: None,
            })
            .collect_vec();
        if let Some(p) = item.publisher {
            creators.push(MetadataFreeCreator {
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
            lot: MediaLot::Book,
            source: MediaSource::GoogleBooks,
            title: item.title,
            description: item.description,
            creators: creators.into_iter().unique().collect(),
            genres: genres.into_iter().unique().collect(),
            publish_year: item.published_date.and_then(|d| convert_date_to_year(&d)),
            publish_date: None,
            book_specifics: Some(BookSpecifics {
                pages: item.page_count,
            }),
            url_images: images.unique().collect(),
            provider_rating: item.average_rating,
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
