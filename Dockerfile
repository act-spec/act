# syntax=docker/dockerfile:1.7
#
# ghcr.io/act-spec/actree — Go-based image (PRIMARY).
#
# This is the default build for v0.2: a static Go binary on distroless. The
# legacy Node variant lives in ./Dockerfile.node and ships under the
# `:<version>-node` tag for users who need TS-only features the Go CLI does
# not yet implement.
#
# Multi-stage build:
#   Stage 1 (builder): golang:1.23-alpine cross-compiles via go/scripts/build.sh.
#   Stage 2 (runtime): gcr.io/distroless/static-debian12:nonroot — no shell,
#                      no libc, just the static binary. ~5MB final image vs
#                      ~150MB for the Node variant, and a much smaller CVE
#                      surface.
#
# Cross-arch: docker buildx sets TARGETARCH per platform; we forward it to
# the build script. CGO is already disabled in build.sh so the binary is
# fully static and runs on any linux/amd64 or linux/arm64 host.
#
# ENTRYPOINT is the `actree` Go binary copied to /actree.

ARG GO_VERSION=1.23

# ---------- Stage 1: builder ----------
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS builder

# bash is needed for go/scripts/build.sh; git is used by `go build` to embed
# version info via -ldflags when a tag is present.
RUN apk add --no-cache bash git

WORKDIR /work

# Copy only the Go module so the layer cache holds across non-Go changes.
COPY go ./go

# TARGETOS/TARGETARCH are set by buildx for each requested platform.
ARG TARGETOS
ARG TARGETARCH

# Build a single linux/$TARGETARCH binary. The script writes to
# /work/go/dist/actree-linux-<arch>; we move it to a stable name for the
# next stage to copy regardless of arch.
RUN cd go && bash scripts/build.sh "${TARGETOS:-linux}" "${TARGETARCH}" \
 && mv "dist/actree-${TARGETOS:-linux}-${TARGETARCH}" /actree

# ---------- Stage 2: runtime ----------
# distroless/static is the right base for a CGO-disabled Go binary: no libc
# needed, runs as nonroot (uid 65532) by default, ships ca-certificates and
# /etc/passwd so net/http can do TLS without surprises.
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

COPY --from=builder /actree /actree

# Distroless `:nonroot` already sets USER nonroot:nonroot.
ENTRYPOINT ["/actree"]

LABEL org.opencontainers.image.title="actree"
LABEL org.opencontainers.image.description="ACT (Agent Content Tree) reference CLI (Go binary, distroless)."
LABEL org.opencontainers.image.source="https://github.com/act-spec/act"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.authors="Jeremy Forsythe <jeremy@act-spec.org>"
LABEL org.opencontainers.image.url="https://act-spec.org"
