use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use surf::{
    http::headers::{AUTHORIZATION, USER_AGENT},
    Client, Config, Url,
};
use urlencoding::encode;

use crate::media::{
    resolver::{MediaSearchItem, SearchResults},
    SeenStatus,
};

use super::MovieSpecifics;

#[derive(Debug, Clone)]
pub struct TmdbService {
    client: Client,
    image_url: String,
}

impl TmdbService {
    pub async fn new(url: &str, access_token: &str) -> Self {
        let client: Client = Config::new()
            .add_header(USER_AGENT, "ignisda/trackona")
            .unwrap()
            .add_header(AUTHORIZATION, format!("Bearer {access_token}"))
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbImageConfiguration {
            secure_base_url: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbConfiguration {
            images: TmdbImageConfiguration,
        }
        let mut rsp = client.get("configuration").await.unwrap();
        let data: TmdbConfiguration = rsp.body_json().await.unwrap();
        Self {
            client,
            image_url: data.images.secure_base_url,
        }
    }
}

impl TmdbService {
    pub async fn details(&self, identifier: &str) -> Result<MediaSearchItem<MovieSpecifics>> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbAuthor {
            name: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbMovie {
            id: i32,
            title: String,
            overview: String,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            production_companies: Vec<TmdbAuthor>,
            release_date: String,
            runtime: i32,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbMovie = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut images = vec![];
        if let Some(c) = data.poster_path {
            images.push(self.get_cover_image_url(&c));
        };
        if let Some(c) = data.backdrop_path {
            images.push(self.get_cover_image_url(&c));
        };
        let detail = MediaSearchItem {
            identifier: data.id.to_string(),
            title: data.title,
            author_names: data
                .production_companies
                .into_iter()
                .map(|p| p.name)
                .collect(),
            images,
            status: SeenStatus::Undetermined,
            publish_year: Self::convert_date_to_year(&data.release_date),
            description: Some(data.overview),
            specifics: MovieSpecifics {
                runtime: Some(data.runtime),
            },
        };
        Ok(detail)
    }

    pub async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MovieSpecifics>> {
        #[derive(Serialize, Deserialize)]
        struct Query {
            query: String,
            page: i32,
            language: String,
        }
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct TmdbBook {
            id: i32,
            poster_path: Option<String>,
            overview: Option<String>,
            title: String,
            release_date: String,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct TmdbSearchResponse {
            total_results: i32,
            results: Vec<TmdbBook>,
        }
        let mut rsp = self
            .client
            .get("search/movie")
            .query(&Query {
                query: encode(query).into_owned(),
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
                let images = if let Some(c) = d.poster_path {
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
                    status: SeenStatus::Undetermined,
                    specifics: MovieSpecifics { runtime: None },
                    images,
                }
            })
            .collect::<Vec<_>>();
        Ok(SearchResults {
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
