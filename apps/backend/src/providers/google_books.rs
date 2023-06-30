use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::{AudibleConfig, GoogleBooksConfig},
    graphql::{AUTHOR, PROJECT_NAME},
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    miscellaneous::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl, PAGE_LIMIT,
    },
    models::media::AudioBookSpecifics,
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, convert_string_to_date, NamedObject},
};

pub static URL: &str = "https://www.googleapis.com/books/v1/volumes";

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
    pub fn new(config: &GoogleBooksConfig) -> Self {
        let client = Config::new()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .set_base_url(Url::parse(URL).unwrap())
            .try_into()
            .unwrap();
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for GoogleBooksService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        let index = (page - 1) * PAGE_LIMIT;
        #[derive(Serialize, Deserialize, Debug)]
        #[serde(rename_all = "camelCase")]
        struct ImageLinks {
            small_thumbnail: Option<String>,
            thumbnail: Option<String>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        #[serde(rename_all = "camelCase")]
        struct ItemVolumeInfo {
            title: String,
            published_date: Option<String>,
            image_links: Option<ImageLinks>,
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
                let mut images = vec![];
                if let Some(il) = b.volume_info.image_links {
                    if let Some(a) = il.thumbnail {
                        images.push(a);
                    }
                    if let Some(a) = il.small_thumbnail {
                        images.push(a);
                    }
                }
                MediaSearchItem {
                    identifier: b.id,
                    lot: MetadataLot::Book,
                    title: b.volume_info.title,
                    images,
                    publish_year: b
                        .volume_info
                        .published_date
                        .map(|d| convert_date_to_year(&d))
                        .flatten(),
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
