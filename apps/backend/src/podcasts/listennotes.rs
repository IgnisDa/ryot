use std::collections::HashMap;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_with::{formats::Flexible, serde_as, TimestampMilliSeconds};
use surf::Client;

use crate::config::PodcastConfig;
use crate::media::resolver::MediaDetails;
use crate::media::MediaSpecifics;
use crate::media::{
    resolver::{MediaSearchItem, MediaSearchResults},
    LIMIT,
};
use crate::migrator::{MetadataLot, PodcastSource};
use crate::podcasts::{PodcastEpisode, PodcastSpecifics};
use crate::traits::MediaProvider;
use crate::utils::listennotes;

#[derive(Serialize, Deserialize, Debug)]
struct IgdbGenre {
    name: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbImage {
    image_id: String,
    url: String,
}

#[derive(Debug, Clone)]
pub struct ListennotesService {
    client: Client,
    genres: HashMap<i32, String>,
}

impl ListennotesService {
    pub async fn new(config: &PodcastConfig) -> Self {
        let (client, genres) = listennotes::get_client_config(
            &config.listennotes.url,
            &config.listennotes.api_token,
            &config.listennotes.user_agent,
        )
        .await;
        Self { client, genres }
    }
}

#[async_trait]
impl MediaProvider for ListennotesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title: String,
            description: Option<String>,
            id: String,
            #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
            #[serde(rename = "earliest_pub_date_ms")]
            publish_date: Option<DateTimeUtc>,
            image: Option<String>,
            episodes: Vec<PodcastEpisode>,
            genre_ids: Vec<i32>,
        }
        let mut rsp = self
            .client
            .get(format!("podcasts/{}", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let d: Podcast = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        Ok(MediaDetails {
            identifier: d.id,
            title: d.title,
            description: d.description,
            lot: MetadataLot::Podcast,
            creators: vec![],
            genres: d
                .genre_ids
                .into_iter()
                .filter_map(|g| self.genres.get(&g).cloned())
                .collect(),
            poster_images: Vec::from_iter(d.image),
            backdrop_images: vec![],
            publish_year: d.publish_date.map(|r| r.year()),
            publish_date: d.publish_date.map(|d| d.date_naive()),
            specifics: MediaSpecifics::Podcast(PodcastSpecifics {
                episodes: d.episodes,
                source: PodcastSource::Listennotes,
            }),
        })
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title_original: String,
            id: String,
            #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
            #[serde(rename = "earliest_pub_date_ms")]
            publish_date: Option<DateTimeUtc>,
            image: Option<String>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct SearchResponse {
            total: i32,
            results: Vec<Podcast>,
        }
        let mut rsp = self
            .client
            .get("search")
            .query(&json!({
                "q": query.to_owned(),
                "offset": (page.unwrap_or_default() - 1) * LIMIT,
                "type": "podcast"
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;

        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let total = search.total;

        let resp = search
            .results
            .into_iter()
            .map(|r| MediaSearchItem {
                identifier: r.id,
                lot: MetadataLot::Podcast,
                title: r.title_original,
                poster_images: Vec::from_iter(r.image),
                publish_year: r.publish_date.map(|r| r.year()),
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults { total, items: resp })
    }
}
