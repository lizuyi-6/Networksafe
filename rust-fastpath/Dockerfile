# DP-008 (audit 2026-08): digest-pinned base images (floating tags let a
# registry compromise or tag mutation silently change the build toolchain).
FROM rust:1.85-bookworm@sha256:e51d0265072d2d9d5d320f6a44dde6b9ef13653b035098febd68cce8fa7c0bc4 AS builder
WORKDIR /app
COPY rust-fastpath/ ./
RUN cargo build --release

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
RUN mkdir -p /var/run/aetherguard-fastpath

COPY --from=builder /app/target/release/aetherguard-fastpath /usr/local/bin/aetherguard-fastpath
ENV PORT=8081
EXPOSE 8081
# DP-013 (audit 2026-08): run unprivileged — the sidecar only needs its unix
# socket dir (created world-writable below so the non-root uid can use it).
RUN chmod 0777 /var/run/aetherguard-fastpath \
    && adduser --disabled-password --no-create-home --gecos "" fastpath
USER fastpath
CMD ["aetherguard-fastpath"]
