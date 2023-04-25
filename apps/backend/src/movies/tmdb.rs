use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use surf::Client;

use crate::{
    media::resolver::{MediaSearchItem, MediaSearchResults},
    utils::get_tmdb_config,
};

use super::MovieSpecifics;

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
        struct TmdbCreator {
            name: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbMovie {
            id: i32,
            title: String,
            overview: String,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            production_companies: Vec<TmdbCreator>,
            release_date: String,
            runtime: i32,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbMovie = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut poster_images = vec![];
        if let Some(c) = data.poster_path {
            poster_images.push(self.get_cover_image_url(&c));
        };
        let mut backdrop_images = vec![];
        if let Some(c) = data.backdrop_path {
            backdrop_images.push(self.get_cover_image_url(&c));
        };
        let detail = MediaSearchItem {
            identifier: data.id.to_string(),
            title: data.title,
            author_names: data
                .production_companies
                .into_iter()
                .map(|p| p.name)
                .collect(),
            poster_images,
            backdrop_images,
            publish_year: Self::convert_date_to_year(&data.release_date),
            description: Some(data.overview),
            movie_specifics: Some(MovieSpecifics {
                runtime: Some(data.runtime),
            }),
            book_specifics: None,
            show_specifics: None,
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
                    title: d.title,
                    description: d.overview,
                    author_names: vec![],
                    publish_year: Self::convert_date_to_year(&d.release_date),
                    movie_specifics: Some(MovieSpecifics { runtime: None }),
                    book_specifics: None,
                    show_specifics: None,
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

    fn convert_date_to_year(d: &str) -> Option<i32> {
        NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .map(|d| d.format("%Y").to_string().parse::<i32>().unwrap())
            .ok()
    }
}
