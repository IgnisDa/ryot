use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::books::resolver::{Book, BookSearch};

static LIMIT: i32 = 20;

#[derive(Debug, Clone)]
pub struct OpenlibraryService {
    image_url: String,
    image_size: String,
    client: Client,
}

impl OpenlibraryService {
    pub fn new(url: &str, image_url: &str, image_size: &str) -> Self {
        let client = Config::new()
            .add_header(USER_AGENT, "ignisda/trackona")
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        Self {
            image_url: image_url.to_owned(),
            image_size: image_size.to_owned(),
            client,
        }
    }
}

impl OpenlibraryService {
    pub async fn details(
        &self,
        identifier: &str,
        query: &str,
        offset: Option<i32>,
        index: i32,
    ) -> Result<Book> {
        let mut detail = self.search(query, offset).await?.books[index as usize].clone();
        #[derive(Debug, Serialize, Deserialize)]
        pub struct OpenlibraryBook {
            description: Option<String>,
        }
        let mut rsp = self
            .client
            .get(format!("works/{}.json", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: OpenlibraryBook = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        detail.description = data.description;
        Ok(detail)
    }

    pub async fn search(&self, query: &str, offset: Option<i32>) -> Result<BookSearch> {
        #[derive(Serialize, Deserialize)]
        struct Query {
            q: String,
            fields: String,
            offset: i32,
            limit: i32,
            #[serde(rename = "type")]
            lot: String,
        }
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct OpenlibraryBook {
            key: String,
            title: String,
            author_name: Option<Vec<String>>,
            cover_i: Option<i64>,
            publish_year: Option<Vec<i32>>,
            first_publish_year: Option<i32>,
            number_of_pages_median: Option<i32>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct OpenLibrarySearchResponse {
            num_found: i32,
            docs: Vec<OpenlibraryBook>,
        }

        let mut rsp = self
            .client
            .get("search.json")
            .query(&Query {
                q: query.to_owned(),
                fields: [
                    "key",
                    "title",
                    "author_name",
                    "cover_i",
                    "publish_year",
                    "first_publish_year",
                    "number_of_pages_median",
                ]
                .join(","),
                offset: offset.unwrap_or_default(),
                limit: LIMIT,
                lot: "work".to_owned(),
            })
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: OpenLibrarySearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .docs
            .into_iter()
            .map(|d| Book {
                identifier: d.key,
                title: d.title,
                description: None,
                author_names: d.author_name.unwrap_or_default(),
                publish_year: d.first_publish_year,
                num_pages: d.number_of_pages_median,
                image: d
                    .cover_i
                    .map(|c| {
                        Some(format!(
                            "{}/id/{}-{}.jpg?default=false",
                            self.image_url, c, self.image_size
                        ))
                    })
                    .unwrap_or(None),
            })
            .collect::<Vec<_>>();
        Ok(BookSearch {
            total: search.num_found,
            books: resp,
            limit: LIMIT,
        })
    }
}
