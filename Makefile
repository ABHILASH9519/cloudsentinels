build-CloudSentinelsFunction:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -trimpath -ldflags="-s -w" -o "$(ARTIFACTS_DIR)/bootstrap" ./cmd/cloudsentinels-lambda
	cp deploy/eks/airtable-inventory.snapshot.json "$(ARTIFACTS_DIR)/airtable-inventory.snapshot.json"
