# Running it

## Board (UNO Q, `arduino@<tailscale-ip>`)

- **Rover app:** `arduino-app-cli app start user:rccar`. This compiles and flashes the sketch and starts `main.py` in `rccar-main-1`. For a Python-only change, copy `main.py` and run `docker restart rccar-main-1`.
- **Camera:** connect the phone over USB, then start `~/cam/cam.py` (host network, `:8081`).
- **IoT stack:**
  1. `cd ~/undersight/iot`
  2. Create `.env` (chmod 600) with `TS_KEY`, `TS_CHANNEL`, `AWS_ENDPOINT` and `THING`.
  3. Put the certs in `data/certs/{key,cert,ca}.pem` and the models in `data/models/` (`world_320.onnx`, `world_416.onnx`, `classes.txt`).
  4. Run `docker compose up -d --build`.
- **Dashboard:** `http://<board>:1880/dashboard`

## Demo checklist

1. Run a stationary patrol, then another with nothing changed → **CLEAR**.
2. Move or add an object and run again → **REVIEW** with a highlighted region. The verdict appears on the dashboard, in DynamoDB and as an image in S3.
3. Start a patrol from the AWS console by setting the shadow's desired state to `{"patrol":1,"legs":1}`.
4. In the app, tap a live detection box → the rover turns and drives up to it, then stops at about 45 cm.
5. Open `notebooks/analysis.ipynb` for the recorded data.

## Notebook

Refresh the data snapshot by copying the board's `iot/data/hub.db` (use `sqlite3 .backup`, because the DB is in WAL mode) to `notebooks/hub.db`, then run all cells. Needs pandas and matplotlib.
