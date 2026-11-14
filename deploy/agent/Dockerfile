FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/cloudsentinels-agent ./cmd/cloudsentinels-agent

FROM registry.k8s.io/kubectl:v1.31.4 AS kubectl

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/cloudsentinels-agent /cloudsentinels-agent
COPY --from=kubectl /bin/kubectl /usr/local/bin/kubectl
USER nonroot:nonroot
ENTRYPOINT ["/cloudsentinels-agent"]
