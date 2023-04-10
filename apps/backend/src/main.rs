use crate::{config::get_figment_config, migrator::Migrator};
use axum::{
    body::{boxed, Full},
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::Router,
};
use config::AppConfig;
use dotenvy::dotenv;
use rust_embed::RustEmbed;
use sea_orm::Database;
use sea_orm_migration::MigratorTrait;
use std::{error::Error, net::SocketAddr};

mod config;
mod migrator;

static INDEX_HTML: &str = "index.html";

#[derive(RustEmbed)]
#[folder = "../app/out/"]
struct Assets;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt::init();
    dotenv().ok();
    let config: AppConfig = get_figment_config().extract()?;

    let conn = Database::connect(&config.db.url)
        .await
        .expect("Database connection failed");
    Migrator::up(&conn, None).await.unwrap();

    let app = Router::new().fallback(static_handler);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8000));
    tracing::info!("Listening on {}", addr);
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
    Ok(())
}

async fn static_handler(uri: Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');

    if path.is_empty() || path == INDEX_HTML {
        return index_html().await;
    }

    match Assets::iter().find(|asset| asset == path) {
        Some(p) => get_asset(&p).await.unwrap(),
        None => {
            let mut path_components = path.split('/').collect::<Vec<_>>();
            let last_elm = path_components.last_mut().unwrap();
            let path_segment = format!("{}/index.html", last_elm);
            *last_elm = &path_segment;
            match get_asset(&path_components.join("/")).await {
                Some(asset) => asset,
                None => not_found().await,
            }
        }
    }
}

async fn index_html() -> Response {
    match Assets::get(INDEX_HTML) {
        Some(content) => {
            let body = boxed(Full::from(content.data));
            Response::builder()
                .header(header::CONTENT_TYPE, "text/html")
                .body(body)
                .unwrap()
        }
        None => not_found().await,
    }
}

async fn not_found() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(boxed(Full::from("404")))
        .unwrap()
}

async fn get_asset(path: &'_ str) -> Option<Response> {
    Assets::get(path).map(|content| {
        let body = boxed(Full::from(content.data));
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        Response::builder()
            .header(header::CONTENT_TYPE, mime.as_ref())
            .body(body)
            .unwrap()
    })
}
