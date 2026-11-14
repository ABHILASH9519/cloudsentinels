FROM golang:1.23-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/cloudsentinels ./cmd/cloudsentinels

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/cloudsentinels /app/cloudsentinels
COPY deploy/eks/airtable-inventory.snapshot.json /app/deploy/eks/airtable-inventory.snapshot.json
ENV CLOUDSENTINELS_HTTP_ADDR=:8082
ENV AIRTABLE_SNAPSHOT_PATH=/app/deploy/eks/airtable-inventory.snapshot.json
USER nonroot:nonroot
EXPOSE 8082
ENTRYPOINT ["/app/cloudsentinels"]
