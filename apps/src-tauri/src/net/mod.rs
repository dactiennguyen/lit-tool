//! Networking shared by the API and chat: the HTTP clients, per-account proxies, and masked views of traffic for the connection log.

pub mod http;
pub mod inspect;
pub mod proxy;
