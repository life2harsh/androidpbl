# Cloud

## AWS IoT Core (ap-southeast-2)

- **Identity:** thing `rover`, X.509 certificate. The CSR was generated on the board, so the private key never left it. Policy `rover-policy` allows client `rover` only, and only the `rover/*` and own-shadow topics.
- **Transport:** MQTT over TLS on port 8883, QoS 1, from the hub's outbox.
- **Rules** (role `rover-iot-rules`, PutItem / PutObject only):
  - `verdicts_to_dynamodb`: `rover/verdict` → table `rover-verdicts` (pid, cp).
  - `telemetry_to_dynamodb`: `rover/telemetry` → table `rover-telemetry` (device, ts); `expires` = now + 7 days, with TTL enabled.
  - `images_to_s3`: `rover/img/+/+` → `s3://rover-patrol-<account>/<pid>/cp<n>.jpg`. Public access is blocked.
- **Device Shadow:** setting `desired.patrol` (and optionally `legs`) starts a patrol remotely. The hub writes back `reported`.
- **Cost:** on-demand DynamoDB, a small S3 footprint, and IoT messages are within free tier. Budget `rover-1usd` alerts by email at 50% actual / 100% forecast.

Rebuild everything with `iot/aws/setup.sh rover.csr [email]`. It prints `AWS_ENDPOINT` for `iot/.env`.

## ThingSpeak

Channel 3591852. Fields: rear, front, heading, patrolling. Uses `bulk_update.json` once every 16 s (the free-tier rate limit), so no samples are lost to rate limiting.

## Inspecting data

```
aws dynamodb scan --table-name rover-verdicts
aws dynamodb query --table-name rover-telemetry --key-condition-expression "device = :d" --expression-attribute-values '{":d":{"S":"rover"}}' --scan-index-forward false --limit 5
aws s3 ls s3://rover-patrol-263966140548 --recursive
aws iot-data get-thing-shadow --thing-name rover /dev/stdout
```
