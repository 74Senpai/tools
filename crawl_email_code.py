import time
from selenium import webdriver 
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import logging
import re

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)

class Crawl:

    def start_crawl(self):
        self.driver = webdriver.Chrome()
        self.wait = WebDriverWait(self.driver, 20)
        self.driver.get("https://temp-mail.org/en/")
        
    def email_crawl(self, email_typing_callback):
        while True:
            email_input = self.wait.until(EC.presence_of_element_located((By.ID, "mail")))
            email = email_input.get_attribute("value").strip()
            if email and "@" in email:
                logging.info(f"Đã lấy được email: {email}")
                email_typing_callback(email)
                break

            logging.info("Đang chờ email khởi tạo...")
            time.sleep(1)


    def code_crawl(self, code_typing_callback, timeout=90):
        logging.info("Đang đợi thư mới gửi đến...")
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                inbox_list = self.driver.find_elements(
                    By.CSS_SELECTOR, ".inbox-dataList ul li"
                )
                
                if not inbox_list:
                    time.sleep(2)
                    continue

                # check hết email
                for inbox in inbox_list:
                    try:
                        subject = inbox.get_attribute("innerText").strip()
                        if not subject:
                            continue

                        logging.info(f"Check subject: {subject}")

                        match = re.search(r'\b\d{4,6}\b', subject)
                        if match:
                            code = match.group()
                            logging.info(f"OTP tìm được: {code}")

                            code_typing_callback(code)
                            return code

                    except Exception:
                        # lỗi 1 mail thì bỏ qua mail đó
                        continue

            except Exception:
                logging.error("Lỗi crawl inbox", exc_info=True)

            time.sleep(2)

        raise TimeoutError("Không nhận được OTP trong thời gian cho phép")


    def end_task(self):
        self.driver.close()

# # Input id="mail"

crawl = Crawl()
crawl.start_crawl()
crawl.email_crawl(print)
crawl.code_crawl(print)