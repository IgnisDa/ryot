use std::{collections::HashMap, env, sync::OnceLock};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use itertools::Itertools;
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_with::{formats::Flexible, serde_as, TimestampMilliSeconds};
use surf::Client;

use crate::{
    config::PodcastConfig,
    migrator::{MetadataLot, MetadataSource},
    models::{
        media::{
            MediaDetails, MediaSearchItem, MediaSpecifics, MetadataCreator, MetadataImage,
            MetadataImageLot, PartialMetadata, PodcastEpisode, PodcastSpecifics,
        },
        SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

static URL: &str = "https://listen-api.listennotes.com/api/v2/";
static GENRES: OnceLock<HashMap<i32, String>> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct ListennotesService {
    client: Client,
    page_limit: i32,
}

impl MediaProviderLanguages for ListennotesService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl ListennotesService {
    pub async fn new(config: &PodcastConfig, page_limit: i32) -> Self {
        let client = get_client_config(
            env::var("LISTENNOTES_API_URL")
                .unwrap_or_else(|_| URL.to_owned())
                .as_str(),
            &config.listennotes.api_token,
        )
        .await;
        Self { client, page_limit }
    }
}

#[async_trait]
impl MediaProvider for ListennotesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let mut details = self
            .details_with_paginated_episodes(identifier, None, None)
            .await?;
        #[derive(Serialize, Deserialize, Debug)]
        struct Recommendation {
            id: String,
            title: String,
            thumbnail: Option<String>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct RecommendationResp {
            recommendations: Vec<Recommendation>,
        }
        let rec_data: RecommendationResp = self
            .client
            .get(format!("podcasts/{}/recommendations", identifier))
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .map_err(|e| anyhow!(e))?;
        details.suggestions = rec_data
            .recommendations
            .into_iter()
            .map(|r| PartialMetadata {
                title: r.title,
                image: r.thumbnail,
                identifier: r.id,
                lot: MetadataLot::Podcast,
                source: MetadataSource::Listennotes,
            })
            .collect();
        match details.specifics {
            MediaSpecifics::Podcast(ref mut specifics) => loop {
                if specifics.total_episodes > i32::try_from(specifics.episodes.len()).unwrap() {
                    let last_episode = specifics.episodes.last().unwrap();
                    let next_pub_date = last_episode.publish_date;
                    let episode_number = last_episode.number;
                    let new_details = self
                        .details_with_paginated_episodes(
                            identifier,
                            Some(next_pub_date),
                            Some(episode_number),
                        )
                        .await?;
                    match new_details.specifics {
                        MediaSpecifics::Podcast(p) => {
                            specifics.episodes.extend(p.episodes);
                        }
                        _ => unreachable!(),
                    }
                } else {
                    break;
                }
            },
            _ => unreachable!(),
        };
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
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
                "offset": (page - 1) * self.page_limit,
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
                title: r.title_original,
                image: r.image,
                publish_year: r.publish_date.map(|r| r.year()),
            })
            .collect_vec();
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items: resp,
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
            explicit_content: Option<bool>,
            description: Option<String>,
            listen_score: Option<Decimal>,
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
        let podcast_data: Podcast = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        Ok(MediaDetails {
            identifier: podcast_data.id,
            title: podcast_data.title,
            is_nsfw: podcast_data.explicit_content,
            production_status: "Released".to_owned(),
            description: podcast_data.description,
            lot: MetadataLot::Podcast,
            source: MetadataSource::Listennotes,
            creators: Vec::from_iter(podcast_data.publisher.map(|p| MetadataCreator {
                name: p,
                role: "Publishing".to_owned(),
                image: None,
            })),
            genres: podcast_data
                .genre_ids
                .into_iter()
                .filter_map(|g| GENRES.get().unwrap().get(&g).cloned())
                .unique()
                .collect(),
            images: Vec::from_iter(podcast_data.image.map(|a| MetadataImage {
                url: StoredUrl::Url(a),
                lot: MetadataImageLot::Poster,
            })),
            videos: vec![],
            publish_year: podcast_data.publish_date.map(|r| r.year()),
            publish_date: podcast_data.publish_date.map(|d| d.date_naive()),
            specifics: MediaSpecifics::Podcast(PodcastSpecifics {
                episodes: podcast_data
                    .episodes
                    .into_iter()
                    .enumerate()
                    .map(|(idx, episode)| PodcastEpisode {
                        number: (episode_number.unwrap_or_default() + idx as i32 + 1),
                        runtime: episode.runtime.map(|r| r / 60), // the api responds in seconds
                        ..episode
                    })
                    .collect(),
                total_episodes: podcast_data.total_episodes,
            }),
            provider_rating: podcast_data.listen_score,
            suggestions: vec![],
            groups: vec![],
        })
    }
}

async fn get_client_config(url: &str, api_token: &str) -> Client {
    let client: Client = get_base_http_client(url, vec![("X-ListenAPI-Key", api_token)]);
    if GENRES.get().is_none() {
        #[derive(Debug, Serialize, Deserialize, Default)]
        struct Genre {
            id: i32,
            name: String,
        }
        #[derive(Debug, Serialize, Deserialize, Default)]
        struct GenreResponse {
            genres: Vec<Genre>,
        }
        let mut rsp = client.get("genres").await.unwrap();
        let data: GenreResponse = rsp.body_json().await.unwrap_or_default();
        let mut genres = HashMap::new();
        for genre in data.genres {
            genres.insert(genre.id, genre.name);
        }
        GENRES.set(genres).ok();
    };
    client
}
