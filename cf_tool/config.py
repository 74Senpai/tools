import logging
from inference_sdk import InferenceHTTPClient

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)

log = logging


CLIENT = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key="t6dPDBWu7Ulh5zGQM1CZ"
)

PKG_NAME = "com.tencent.stc.cfl"
INVITE_CODES = ["GLHBPJWYC"]
LOOPS_PER_CODE = 30
START_TIME = 80
TOTAL_STEP = 31
MAX_LOOP_DURATION = 600

STEP_PERFORMANCE_DATA = {}
DEFAULT_TIMEOUT = 30
MAX_TIMEOUT = 60
MIN_TIMEOUT = 10
BUFFER_PERCENT = 1.5
MY_DEVICE_ID = "emulator-5554"