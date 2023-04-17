use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use super::resolver::BookSearch;

#[derive(Debug, Clone)]
pub struct OpenlibraryService {
    image_url: String,
    client: Client,
}

impl OpenlibraryService {
    pub fn new(url: &str, image_url: &str) -> Self {
        let client = Config::new()
            .add_header(USER_AGENT, "ignisda/trackona")
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        Self {
            image_url: image_url.to_owned(),
            client,
        }
    }
}

impl OpenlibraryService {
    pub async fn search(&self, query: &'_ str, offset: Option<i32>) -> Result<Vec<BookSearch>> {
        #[derive(Serialize, Deserialize)]
        struct Query {
            q: String,
            fields: String,
            offset: i32,
            limit: i32,
        }
        let q = Query {
            q: query.to_owned(),
            fields: [
                "title",
                "key",
                "author_name",
                "cover_i",
                "language",
                "edition_key",
            ]
            .join(","),
            offset: offset.unwrap_or_default(),
            limit: 10,
        };

        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct OpenlibraryBook {
            key: String,
            title: String,
            author_name: Vec<String>,
            cover_i: Option<i64>,
        }
        #[derive(Serialize, Deserialize)]
        struct SearchResponse {
            docs: Vec<OpenlibraryBook>,
        }
        let mut rsp = self
            .client
            .get("search.json")
            .query(&q)
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .docs
            .into_iter()
            .map(|d| BookSearch {
                identifier: d.key,
                title: d.title,
                author_names: d.author_name,
                image: d
                    .cover_i
                    .map(|c| Some(format!("{}/id/{}-L.jpg?default=false", self.image_url, c)))
                    .unwrap_or(None),
            })
            .collect::<Vec<_>>();

        Ok(resp)
    }
}
