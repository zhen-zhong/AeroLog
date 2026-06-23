FROM golang:1.22-alpine AS build

ARG SERVICE
WORKDIR /src
COPY server ./server
RUN cd "/src/server/${SERVICE}" && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/aerolog ./cmd

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/aerolog /usr/local/bin/aerolog
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/aerolog"]
