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
use crate::media::{
    resolver::{MediaSearchItem, MediaSearchResults},
    PAGE_LIMIT,
};
use crate::media::{MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl};
use crate::migrator::{MetadataImageLot, MetadataLot, PodcastSource};
use crate::podcasts::{PodcastEpisode, PodcastSpecifics};
use crate::traits::MediaProvider;
use crate::utils::listennotes;

#[derive(Debug, Clone)]
pub struct ListennotesService {
    client: Client,
    genres: HashMap<i32, String>,
}

impl ListennotesService {
    pub async fn new(config: &PodcastConfig) -> Self {
        let (client, genres) =
            listennotes::get_client_config(&config.listennotes.url, &config.listennotes.api_token)
                .await;
        Self { client, genres }
    }
}

#[async_trait]
impl MediaProvider for ListennotesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        self.details_with_paginated_episodes(identifier, None, None)
            .await
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
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
            next_offset: Option<i32>,
        }
        let mut rsp = self
            .client
            .get("search")
            .query(&json!({
                "q": query.to_owned(),
                "offset": (page - 1) * PAGE_LIMIT,
                "type": "podcast"
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;

        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let total = search.total;

        let next_page = search.next_offset.map(|_| page + 1);
        let resp = search
            .results
            .into_iter()
            .map(|r| MediaSearchItem {
                identifier: r.id,
                lot: MetadataLot::Podcast,
                title: r.title_original,
                images: Vec::from_iter(r.image),
                publish_year: r.publish_date.map(|r| r.year()),
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults {
            total,
            items: resp,
            next_page,
        })
    }
}

impl ListennotesService {
    // The API does not return all the episodes for a podcast, and instead needs to be
    // paginated through. It also does not return the episode number. So we have to
    // handle those manually.
    pub async fn details_with_paginated_episodes(
        &self,
        identifier: &str,
        next_pub_date: Option<i64>,
        episode_number: Option<i32>,
    ) -> Result<MediaDetails> {
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title: String,
            description: Option<String>,
            id: String,
            #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
            #[serde(rename = "earliest_pub_date_ms")]
            publish_date: Option<DateTimeUtc>,
            publisher: Option<String>,
            image: Option<String>,
            episodes: Vec<PodcastEpisode>,
            genre_ids: Vec<i32>,
            total_episodes: i32,
        }
        let mut rsp = self
            .client
            .get(format!("podcasts/{}", identifier))
            .query(&json!({
                "sort": "oldest_first",
                "next_episode_pub_date": next_pub_date.map(|d| d.to_string()).unwrap_or_else(|| "null".to_owned())
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let d: Podcast = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        Ok(MediaDetails {
            identifier: d.id,
            title: d.title,
            description: d.description,
            lot: MetadataLot::Podcast,
            creators: Vec::from_iter(d.publisher.map(|p| MetadataCreator {
                name: p,
                role: "Publishing".to_owned(),
                image_urls: vec![],
            })),
            genres: d
                .genre_ids
                .into_iter()
                .filter_map(|g| self.genres.get(&g).cloned())
                .collect(),
            images: Vec::from_iter(d.image.map(|a| MetadataImage {
                url: MetadataImageUrl::Url(a),
                lot: MetadataImageLot::Poster,
            })),
            publish_year: d.publish_date.map(|r| r.year()),
            publish_date: d.publish_date.map(|d| d.date_naive()),
            specifics: MediaSpecifics::Podcast(PodcastSpecifics {
                episodes: d
                    .episodes
                    .into_iter()
                    .enumerate()
                    .map(|(idx, episode)| PodcastEpisode {
                        number: (episode_number.unwrap_or_default() + idx as i32 + 1),
                        runtime: episode.runtime.map(|r| r / 60), // the api responds in seconds
                        ..episode
                    })
                    .collect(),
                source: PodcastSource::Listennotes,
                total_episodes: d.total_episodes,
            }),
        })
    }
}
