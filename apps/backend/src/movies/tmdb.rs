use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use surf::{
    http::headers::{AUTHORIZATION, USER_AGENT},
    Client, Config, Url,
};
use tokio::task::JoinSet;
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
    pub async fn details(
        &self,
        identifier: &str,
        query: &str,
        offset: Option<i32>,
        index: i32,
    ) -> Result<MediaSearchItem<MovieSpecifics>> {
        let mut detail = self.search(query, offset).await?.items[index as usize].clone();
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbKey {
            key: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbAuthor {
            author: TmdbKey,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        #[serde(untagged)]
        enum TmdbDescription {
            Text(String),
            Nested {
                #[serde(rename = "type")]
                key: String,
                value: String,
            },
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbBook {
            description: Option<TmdbDescription>,
            covers: Option<Vec<i64>>,
            authors: Vec<TmdbAuthor>,
        }
        let mut rsp = self
            .client
            .get(format!("works/{}.json", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbBook = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut set = JoinSet::new();
        #[derive(Debug, Serialize, Deserialize)]
        struct TmdbAuthorPartial {
            name: String,
        }
        for author in data.authors.into_iter() {
            let client = self.client.clone();
            set.spawn(async move {
                let mut rsp = client
                    .get(format!("{}.json", author.author.key))
                    .await
                    .unwrap();
                let TmdbAuthorPartial { name } = rsp.body_json().await.unwrap();
                name
            });
        }
        let mut authors = vec![];
        while let Some(Ok(result)) = set.join_next().await {
            authors.push(result);
        }
        detail.description = data.description.map(|d| match d {
            TmdbDescription::Text(s) => s,
            TmdbDescription::Nested { value, .. } => value,
        });
        // detail.images = data
        //     .covers
        //     .unwrap_or_default()
        //     .into_iter()
        //     .map(|c| self.get_cover_image_url(c))
        //     .collect();
        detail.author_names = authors;
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
                let release_year = NaiveDate::parse_from_str(&d.release_date, "%Y-%m-%d")
                    .map(|d| d.format("%Y").to_string().parse::<i32>().unwrap())
                    .ok();
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
                    publish_year: release_year,
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
}
