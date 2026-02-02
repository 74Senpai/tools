import time
import random
import string
import re
import logging
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)

class Crawl:

    def start_crawl(self):
        options = webdriver.ChromeOptions()
        options.add_argument("--start-maximized")
        # Chặn quảng cáo và popups để đỡ che khuất
        options.add_argument("--disable-popup-blocking") 
        
        self.driver = webdriver.Chrome(options=options)
        self.wait = WebDriverWait(self.driver, 20)
        self.driver.get("https://yopmail.com/")
        
        # --- FIX: TẮT POPUP COOKIE NẾU CÓ ---
        try:
            time.sleep(1)
            consent_btn = self.driver.find_element(By.ID, "necesary")
            consent_btn.click()
            print("🍪 Đã đóng popup Cookie")
        except:
            pass

    def _get_random_name(self, length=8):
        chars = string.ascii_lowercase + string.digits
        return ''.join(random.choices(chars, k=length))

    def email_crawl(self, email_typing_callback):
        try:
            email_name = self._get_random_name()
            full_email = f"{email_name}@yopmail.com"
            logging.info(f"📧 Đang khởi tạo email: {full_email}")

            input_field = self.wait.until(EC.presence_of_element_located((By.ID, "login")))
            input_field.clear()
            input_field.send_keys(email_name)
            time.sleep(0.5)

            try:
                # Selector này đôi khi thay đổi, dùng ID cho chắc
                refresh_btn = self.driver.find_element(By.CSS_SELECTOR, "#refreshbut > button")
                refresh_btn.click()
            except:
                input_field.send_keys(Keys.RETURN)

            time.sleep(2)
            logging.info(f"✅ Đã vào Inbox. Đang chờ email đến...")

            if email_typing_callback:
                email_typing_callback(full_email)
            
            return full_email

        except Exception as e:
            logging.error(f"❌ Lỗi khi tạo email: {e}")
            raise e

    def code_crawl(self, code_typing_callback, timeout=120): # Tăng timeout lên 120s
        logging.info("📬 Bắt đầu canh inbox...")
        start_time = time.time()

        # --- FIX REGEX ---
        # Đổi thành \d{4,8} để bắt được cả code 4 số, 5 số (71333), 6 số...
        code_pattern = re.compile(r'\b\d{4,8}\b') 

        while time.time() - start_time < timeout:
            try:
                # 1. VÀO IFRAME ĐỌC THƯ
                try:
                    self.driver.switch_to.frame("ifmail")
                    
                    # Lấy text body
                    body_element = self.driver.find_element(By.TAG_NAME, "body")
                    email_content = body_element.text.strip()
                    
                    # --- DEBUG LOG: In ra xem bot thấy gì ---
                    if email_content:
                        # Chỉ in 50 ký tự đầu để debug xem có phải mail rác hay mail thật
                        print(f"   👀 Bot thấy nội dung: {email_content[:50]}...")
                    
                    # Tìm code
                    match = code_pattern.search(email_content)
                    
                    if match:
                        code = match.group(0)
                        # Kiểm tra logic phụ: Code không phải là ngày tháng năm hiện tại (tránh bắt nhầm năm 2024)
                        if code != "2024" and code != "2025": 
                            logging.info(f"🎉 OTP TÌM THẤY: {code}")
                            self.driver.switch_to.default_content()
                            
                            if code_typing_callback:
                                code_typing_callback(code)
                            return code
                        
                except Exception:
                    pass
                
                # 2. RA NGOÀI REFRESH
                self.driver.switch_to.default_content()
                
                try:
                    refresh_btn = self.driver.find_element(By.ID, "refresh")
                    refresh_btn.click()
                except:
                    pass

                time.sleep(3) # Chờ load sau refresh

            except Exception as e:
                logging.error(f"⚠️ Lỗi vòng lặp: {e}")
                self.driver.switch_to.default_content()

        logging.error("⏰ TIMEOUT: Không tìm thấy code nào khớp regex!")
        raise TimeoutError("Timeout")

    def end_task(self):
        if hasattr(self, 'driver'):
            self.driver.quit()

