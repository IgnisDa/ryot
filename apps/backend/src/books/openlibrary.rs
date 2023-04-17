use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

#[derive(Debug)]
pub struct OpenlibraryService {
    client: Client,
}

impl OpenlibraryService {
    pub fn new(url: &'_ str) -> Self {
        let client = Config::new()
            .add_header(USER_AGENT, "ignisda/trackona")
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        Self { client }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenlibraryBook {
    key: String,
    title: String,
    author_name: Vec<String>,
    cover_i: Option<i128>,
}

impl OpenlibraryService {
    pub async fn search(
        &self,
        query: &'_ str,
        offset: Option<i32>,
    ) -> Result<Vec<OpenlibraryBook>> {
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

        Ok(search.docs)
    }
}
