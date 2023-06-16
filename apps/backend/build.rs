use std::{fs, path::Path};

use anyhow::{anyhow, Result};
use serde_json::Value;
use surf::http::headers::{ACCEPT, CONTENT_TYPE};

static ROOT_DIR: &str = env!("CARGO_MANIFEST_DIR");
static GENERATED_DIR: &str = "generated";
static SERVER_URL: &str = "https://graphql.anilist.co/";
static INTROSPECTION_QUERY: &str = r#"{ "query": "query IntrospectionQuery{__schema{queryType{name}mutationType{name}subscriptionType{name}types{...FullType}directives{name description locations args{...InputValue}}}}fragment FullType on __Type{kind name description fields(includeDeprecated:true){name description args{...InputValue}type{...TypeRef}isDeprecated deprecationReason}inputFields{...InputValue}interfaces{...TypeRef}enumValues(includeDeprecated:true){name description isDeprecated deprecationReason}possibleTypes{...TypeRef}}fragment InputValue on __InputValue{name description type{...TypeRef}defaultValue}fragment TypeRef on __Type{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name}}}}}}}}" }"#;

#[tokio::main]
async fn main() -> Result<()> {
    fs::create_dir(Path::new(ROOT_DIR).join(GENERATED_DIR)).ok();
    generate_anilist_schema().await?;
    Ok(())
}

async fn generate_anilist_schema() -> Result<()> {
    let schema_path = Path::new(ROOT_DIR)
        .join(GENERATED_DIR)
        .join("anilist_schema.json");
    if !schema_path.exists() {
        let response: Value = surf::post(SERVER_URL)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .body(INTROSPECTION_QUERY)
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .map_err(|e| anyhow!(e))?;
        fs::write(schema_path, serde_json::to_string_pretty(&response)?)?;
    }
    Ok(())
}
