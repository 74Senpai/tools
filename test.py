from inference_sdk import InferenceHTTPClient
import logging

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)

CLIENT = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key="t6dPDBWu7Ulh5zGQM1CZ"
)

