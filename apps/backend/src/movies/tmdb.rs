use std::collections::HashSet;

use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::Client;

use crate::{
    config::MoviesTmdbConfig,
    media::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl,
    },
    migrator::{MetadataImageLot, MetadataLot, MovieSource},
    traits::MediaProvider,
    utils::{
        convert_date_to_year, convert_string_to_date,
        tmdb::{self, TmdbCredit},
        NamedObject,
    },
};

use super::MovieSpecifics;

#[derive(Debug, Clone)]
pub struct TmdbService {
    client: Client,
    image_url: String,
}

impl TmdbService {
    pub async fn new(config: &MoviesTmdbConfig) -> Self {
        let (client, image_url) = tmdb::get_client_config(&config.url, &config.access_token).await;
        Self { client, image_url }
    }
}

#[async_trait]
impl MediaProvider for TmdbService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbMovie {
            id: i32,
            title: String,
            overview: String,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            release_date: String,
            runtime: i32,
            genres: Vec<NamedObject>,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}", &identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbMovie = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbCreditsResponse {
            cast: Vec<TmdbCredit>,
            crew: Vec<TmdbCredit>,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}/credits", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let credits: TmdbCreditsResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut all_creators = credits
            .cast
            .clone()
            .into_iter()
            .map(|c| MetadataCreator {
                name: c.name,
                role: c.known_for_department,
                image_urls: Vec::from_iter(c.profile_path.map(|p| self.get_cover_image_url(&p))),
            })
            .collect::<HashSet<_>>();
        all_creators.extend(credits.crew.into_iter().map(|c| MetadataCreator {
            name: c.name,
            role: c.known_for_department,
            image_urls: Vec::from_iter(c.profile_path.map(|p| self.get_cover_image_url(&p))),
        }));
        let mut images = Vec::from_iter(data.poster_path.map(|p| MetadataImage {
            url: MetadataImageUrl::Url(self.get_cover_image_url(&p)),
            lot: MetadataImageLot::Poster,
        }));
        if let Some(u) = data.backdrop_path {
            images.push(MetadataImage {
                url: MetadataImageUrl::Url(self.get_cover_image_url(&u)),
                lot: MetadataImageLot::Backdrop,
            });
        }
        Ok(MediaDetails {
            identifier: data.id.to_string(),
            lot: MetadataLot::Movie,
            title: data.title,
            genres: data.genres.into_iter().map(|g| g.name).collect(),
            creators: Vec::from_iter(all_creators),
            images,
            publish_year: convert_date_to_year(&data.release_date),
            publish_date: convert_string_to_date(&data.release_date),
            description: Some(data.overview),
            specifics: MediaSpecifics::Movie(MovieSpecifics {
                source: MovieSource::Tmdb,
                runtime: Some(data.runtime),
            }),
        })
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct TmdbMovie {
            id: i32,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            overview: Option<String>,
            title: String,
            release_date: String,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct TmdbSearchResponse {
            total_results: i32,
            results: Vec<TmdbMovie>,
        }
        let mut rsp = self
            .client
            .get("search/movie")
            .query(&json!({
                "query": query.to_owned(),
                "page": page.unwrap_or(1),
                "language": "en-US".to_owned(),
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| {
                let images = Vec::from_iter(d.poster_path.map(|p| self.get_cover_image_url(&p)));
                MediaSearchItem {
                    identifier: d.id.to_string(),
                    lot: MetadataLot::Movie,
                    title: d.title,
                    publish_year: convert_date_to_year(&d.release_date),
                    images,
                }
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults {
            total: search.total_results,
            items: resp.to_vec(),
        })
    }
}

impl TmdbService {
    fn get_cover_image_url(&self, c: &str) -> String {
        format!("{}{}{}", self.image_url, "original", c)
    }
}
