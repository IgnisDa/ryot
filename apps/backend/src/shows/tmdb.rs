use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use surf::Client;
use tokio::task::JoinSet;

use crate::{
    media::resolver::{MediaSearchItem, MediaSearchResults},
    utils::{convert_date_to_year, get_tmdb_config},
};

use super::ShowSpecifics;

#[derive(Debug, Clone)]
pub struct TmdbService {
    client: Client,
    image_url: String,
}

impl TmdbService {
    pub async fn new(url: &str, access_token: &str) -> Self {
        let (client, image_url) = get_tmdb_config(url, access_token).await;
        Self { client, image_url }
    }
}

impl TmdbService {
    pub async fn details(&self, identifier: &str) -> Result<MediaSearchItem> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbAuthor {
            name: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbSeasonNumber {
            season_number: i32,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbShow {
            id: i32,
            name: String,
            overview: String,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            production_companies: Vec<TmdbAuthor>,
            first_air_date: String,
            seasons: Vec<TmdbSeasonNumber>,
        }
        let mut rsp = self
            .client
            .get(format!("tv/{}", &identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbShow = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let mut poster_images = vec![];
        if let Some(c) = data.poster_path {
            poster_images.push(self.get_cover_image_url(&c));
        };
        let mut backdrop_images = vec![];
        if let Some(c) = data.backdrop_path {
            backdrop_images.push(self.get_cover_image_url(&c));
        };

        let mut set = JoinSet::new();
        for season in data.seasons.into_iter() {
            let client = self.client.clone();
            let iden = identifier.to_owned();
            set.spawn(async move {
                #[derive(Debug, Serialize, Deserialize, Clone)]
                struct TmdbEpisodeNumber {
                    episode_number: i32,
                }
                #[derive(Debug, Serialize, Deserialize, Clone)]
                struct TmdbSeason {
                    name: String,
                    poster_path: Option<String>,
                    backdrop_path: Option<String>,
                    air_date: String,
                    episodes: Vec<TmdbEpisodeNumber>,
                }
                let mut rsp = client
                    .get(format!("tv/{}/season/{}", iden, season.season_number))
                    .await
                    .unwrap();
                let season: TmdbSeason = rsp.body_json().await.unwrap();
                season
            });
        }
        let mut seasons = vec![];
        while let Some(Ok(result)) = set.join_next().await {
            seasons.push(result);
        }
        dbg!(&seasons);

        let detail = MediaSearchItem {
            identifier: data.id.to_string(),
            title: data.name,
            author_names: data
                .production_companies
                .into_iter()
                .map(|p| p.name)
                .collect(),
            poster_images,
            backdrop_images,
            publish_year: convert_date_to_year(&data.first_air_date),
            description: Some(data.overview),
            show_specifics: Some(ShowSpecifics { runtime: None }),
            movie_specifics: None,
            book_specifics: None,
        };
        Ok(detail)
    }

    pub async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        #[derive(Serialize, Deserialize)]
        struct Query {
            query: String,
            page: i32,
            language: String,
        }
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct TmdbShow {
            id: i32,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            overview: Option<String>,
            name: String,
            first_air_date: String,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct TmdbSearchResponse {
            total_results: i32,
            results: Vec<TmdbShow>,
        }
        let mut rsp = self
            .client
            .get("search/tv")
            .query(&Query {
                query: query.to_owned(),
                page: page.unwrap_or(1),
                language: "en-US".to_owned(),
            })
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| {
                let poster_images = if let Some(c) = d.poster_path {
                    vec![self.get_cover_image_url(&c)]
                } else {
                    vec![]
                };
                let backdrop_images = if let Some(c) = d.backdrop_path {
                    vec![self.get_cover_image_url(&c)]
                } else {
                    vec![]
                };
                MediaSearchItem {
                    identifier: d.id.to_string(),
                    title: d.name,
                    description: d.overview,
                    author_names: vec![],
                    publish_year: convert_date_to_year(&d.first_air_date),
                    show_specifics: Some(ShowSpecifics { runtime: None }),
                    movie_specifics: None,
                    book_specifics: None,
                    poster_images,
                    backdrop_images,
                }
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults {
            total: search.total_results,
            items: resp,
        })
    }

    fn get_cover_image_url(&self, c: &str) -> String {
        format!("{}{}{}", self.image_url, "original", c)
    }
}
