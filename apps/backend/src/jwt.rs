use anyhow::Result;
use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct Claims {
    pub sub: i32,
    pub exp: i64,
    pub iat: i64,
}

impl Claims {
    pub fn new(id: i32, token_valid_for_days: i64) -> Self {
        let iat = Utc::now();
        let exp = iat + Duration::days(token_valid_for_days);

        Self {
            sub: id,
            iat: iat.timestamp(),
            exp: exp.timestamp(),
        }
    }
}

pub fn sign(id: i32, jwt_secret: &str, token_valid_for_days: i64) -> Result<String> {
    Ok(jsonwebtoken::encode(
        &Header::default(),
        &Claims::new(id, token_valid_for_days),
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?)
}

pub fn verify(token: &str, jwt_secret: &str) -> Result<Claims> {
    Ok(jsonwebtoken::decode(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)?)
}
