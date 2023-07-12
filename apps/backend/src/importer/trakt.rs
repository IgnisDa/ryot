use async_graphql::Result;
use convert_case::{Case, Casing};
use serde::{Deserialize, Serialize};
use surf::{http::headers::CONTENT_TYPE, Client, Url};

use crate::{
    importer::{DeployTraktImportInput, ImportResult},
    models::media::CreateOrUpdateCollectionInput,
    utils::get_base_http_client_config,
};

const API_URL: &str = "https://api.trakt.tv";
const CLIENT_ID: &str = "b3d93fd4c53d78d61b18e0f0bf7ad5153de323788dbc0be1a3627205a36e89f5";
const API_VERSION: &str = "2";

#[derive(Debug, Serialize, Deserialize)]
struct Id {
    trakt: u64,
    slug: String,
    tmdb: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Item {
    ids: Id,
}

#[derive(Debug, Serialize, Deserialize)]
struct ListItemResponse {
    movie: Option<Item>,
    show: Option<Item>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListResponse {
    name: String,
    description: Option<String>,
    ids: Id,
    #[serde(default)]
    items: Vec<ListItemResponse>,
}

pub async fn import(input: DeployTraktImportInput) -> Result<ImportResult> {
    let client: Client = get_base_http_client_config()
        .add_header(CONTENT_TYPE, "application/json")
        .unwrap()
        .add_header("trakt-api-key", CLIENT_ID)
        .unwrap()
        .add_header("trakt-api-version", API_VERSION)
        .unwrap()
        .set_base_url(Url::parse(&format!("{}/users/{}/", API_URL, input.username)).unwrap())
        .try_into()
        .unwrap();
    let mut rsp = client.get("lists").await.unwrap();
    let mut lists: Vec<ListResponse> = rsp.body_json().await.unwrap();

    for list in lists.iter_mut() {
        let mut rsp = client
            .get(&format!("lists/{}/items", list.ids.trakt))
            .await
            .unwrap();
        let items: Vec<ListItemResponse> = rsp.body_json().await.unwrap();
        list.items = items;
    }
    for list in ["watchlist", "favorites"] {
        let mut rsp = client.get(&format!("{}", list)).await.unwrap();
        let items: Vec<ListItemResponse> = rsp.body_json().await.unwrap();
        lists.push(ListResponse {
            name: list.to_owned(),
            description: None,
            ids: Id {
                trakt: 0,
                slug: "".to_owned(),
                tmdb: None,
            },
            items,
        });
    }
    let all_collections = lists
        .iter()
        .map(|l| CreateOrUpdateCollectionInput {
            name: l.name.to_case(Case::Title),
            description: l
                .description
                .as_ref()
                .map(|s| if s == "" { None } else { Some(s.to_owned()) })
                .flatten(),
            ..Default::default()
        })
        .collect::<Vec<_>>();
    dbg!(&lists, &all_collections);
    todo!()
}
