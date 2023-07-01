use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use itertools::Itertools;
use sea_orm::prelude::ChronoDateTimeUtc;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::ITunesConfig,
    graphql::USER_AGENT_STR,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    miscellaneous::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl, PAGE_LIMIT,
    },
    models::media::PodcastSpecifics,
    traits::{MediaProvider, MediaProviderLanguages},
};

pub static URL: &str = "https://itunes.apple.com/";

#[derive(Debug, Clone)]
pub struct ITunesService {
    client: Client,
    language: String,
}

impl MediaProviderLanguages for ITunesService {
    fn supported_languages() -> Vec<String> {
        ["en_us", "ja_jp"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "en_us".to_owned()
    }
}

impl ITunesService {
    pub async fn new(config: &ITunesConfig) -> Self {
        let client = Config::new()
            .add_header(USER_AGENT, USER_AGENT_STR)
            .unwrap()
            .set_base_url(Url::parse(URL).unwrap())
            .try_into()
            .unwrap();
        Self {
            client,
            language: config.locale.clone(),
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
struct ItemResponse {
    collection_id: i32,
    collection_name: String,
    release_date: Option<ChronoDateTimeUtc>,
    description: Option<String>,
    artist_name: Option<String>,
    genres: Option<Vec<String>>,
    track_count: i32,
    artwork_url_100: Option<String>,
    artwork_url_30: Option<String>,
    artwork_url_60: Option<String>,
    artwork_url_600: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    results: Option<Vec<ItemResponse>>,
}

#[async_trait]
impl MediaProvider for ITunesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
        // let mut rsp = self.client.get(identifier).await.map_err(|e| anyhow!(e))?;
        // let data: ItemResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        // let d = self.itunes_response_to_search_response(data.volume_info, data.id);
        // Ok(d)
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        let mut rsp = self
            .client
            .get("search")
            .query(&serde_json::json!({
                "term": query,
                "limit": PAGE_LIMIT,
                "media": "podcast",
                "entity": "podcast",
                "lang": self.language
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
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
                } = self.itunes_response_to_search_response(b);
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
        // DEV: API does not return total count
        let total = 100;

        Ok(MediaSearchResults {
            total,
            items: resp,
            next_page: Some(page + 1),
        })
    }
}
impl ITunesService {
    fn itunes_response_to_search_response(&self, item: ItemResponse) -> MediaDetails {
        let mut images = vec![];
        if let Some(a) = item.artwork_url_600 {
            images.push(a);
        }
        if let Some(a) = item.artwork_url_100 {
            images.push(a);
        }
        if let Some(a) = item.artwork_url_30 {
            images.push(a);
        }
        if let Some(a) = item.artwork_url_60 {
            images.push(a);
        }
        let images = images.into_iter().map(|a| MetadataImage {
            url: MetadataImageUrl::Url(a),
            lot: MetadataImageLot::Poster,
        });
        let creators = Vec::from_iter(item.artist_name)
            .into_iter()
            .map(|a| MetadataCreator {
                name: a,
                role: "Artist".to_owned(),
                image_urls: vec![],
            })
            .collect::<Vec<_>>();
        let date = item.release_date.map(|d| d.date_naive());
        MediaDetails {
            identifier: item.collection_id.to_string(),
            lot: MetadataLot::Podcast,
            source: MetadataSource::ITunes,
            title: item.collection_name,
            description: item.description,
            creators: creators.into_iter().unique().collect(),
            genres: item
                .genres
                .unwrap_or_default()
                .into_iter()
                .unique()
                .collect(),
            publish_year: date.map(|d| d.year()),
            publish_date: date,
            specifics: MediaSpecifics::Podcast(PodcastSpecifics {
                total_episodes: item.track_count,
                // FIXME: Use correct one
                episodes: vec![],
            }),
            images: images.unique().collect(),
        }
    }
}
