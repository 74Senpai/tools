import subprocess
import time
import numpy as np
import cv2
import random
import os
import string
from crawl_email_code import Crawl
from config import (
    log,
    PKG_NAME,
    CLIENT,
    BUFFER_PERCENT,
    DEFAULT_TIMEOUT,
    INVITE_CODES,
    LOOPS_PER_CODE,
    MAX_LOOP_DURATION,
    MAX_TIMEOUT,
    MIN_TIMEOUT,
    START_TIME,
    STEP_PERFORMANCE_DATA,
    TOTAL_STEP,
)

crawl = Crawl()

def adb_cmd(cmd, stdout = subprocess.DEVNULL, stderr = subprocess.DEVNULL):
    return subprocess.run(cmd, stdout=stdout, stderr=stderr)


def screen_cap():
    p = subprocess.Popen(
        ["adb", "exec-out", "screencap", "-p"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    img_bytes = p.stdout.read()
    p.stdout.close()
    p.wait()

    img_np = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(img_np, cv2.IMREAD_COLOR)

def handle_captcha_result(result):
    predictions = result.get("predictions", [])
    if not predictions:
        log.warning("Không tìm thấy captcha trong ảnh")
        return False

    # Lấy đối tượng đầu tiên tìm được
    det = predictions[0]
    target_x = det['x'] # Tâm X của lỗ hổng
    target_y = det['y'] # Tâm Y của lỗ hổng
    confidence = det['confidence']

    log.info(f"Tìm thấy Captcha tại X={target_x}, Y={target_y} (Độ tự tin: {confidence:.2f})")

    start_x = 100 
    
    duration = random.randint(600, 1000)
    # Lệnh swipe: x_start y_start x_end y_end duration
    cmd = ["adb", "shell", "input", "swipe", 
           str(start_x), str(target_y), 
           str(target_x), str(target_y), 
           str(duration)]
    
    # adb_cmd(cmd)
    return True


def solve_slide_captcha(cropped_frame):
    try:
        # Gửi ảnh đã cắt lên model
        result = CLIENT.infer(cropped_frame, model_id="slide_captcha/4")
        predictions = result.get("predictions", [])
        
        if not predictions:
            log.warning("Không tìm thấy captcha trong vùng đã cắt")
            return None

        # Lấy kết quả đầu tiên
        det = predictions[0]
        # Trả về tâm của lỗ hổng (X, Y) trong ảnh crop
        return det['x'], det['y']
    except Exception as e:
        log.error(f"Error solving captcha: {e}")
        return None

def detect_match(frame, template, threshold=0.7):
    if frame is None or template is None:
        return False, 0.0

    frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    temp_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)

    if (
        temp_gray.shape[0] > frame_gray.shape[0]
        or temp_gray.shape[1] > frame_gray.shape[1]
    ):
        return False, 0.0

    result = cv2.matchTemplate(frame_gray, temp_gray, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, _ = cv2.minMaxLoc(result)

    return max_val >= threshold, float(max_val)


def find_sub_image(
    large_img, small_img, threshold=0.7, scales=None
):
    if large_img is None or small_img is None:
        return False, None

    # Chuyển xám để xử lý nhanh hơn
    large_gray = cv2.cvtColor(large_img, cv2.COLOR_BGR2GRAY)
    small_gray = cv2.cvtColor(small_img, cv2.COLOR_BGR2GRAY)

    # Nếu không truyền scales, tự động tạo dải mịn từ 0.5 đến 2.0
    if scales is None:
        # Nhảy mỗi 0.05 để không trượt mất tỷ lệ 1.33 của bạn
        scales = [i/100 for i in range(50, 210, 5)] 

    best_score = 0.0
    best_box = None
    best_s = 1.0

    for s in scales:
        # Tính kích thước mới
        new_w = int(small_gray.shape[1] * s)
        new_h = int(small_gray.shape[0] * s)

        # Kiểm tra nếu template sau khi resize to hơn màn hình thì bỏ qua
        if new_h > large_gray.shape[0] or new_w > large_gray.shape[1] or new_h < 10 or new_w < 10:
            continue

        # Dùng INTER_CUBIC để giữ độ sắc nét khi phóng to
        resized = cv2.resize(
            small_gray, (new_w, new_h), interpolation=cv2.INTER_CUBIC if s > 1.0 else cv2.INTER_AREA
        )

        result = cv2.matchTemplate(large_gray, resized, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)

        if max_val > best_score:
            best_score = max_val
            best_box = (max_loc[0], max_loc[1], new_w, new_h)
            best_s = s

    # log.debug(f"Best Match Score: {best_score:.4f} at scale {best_s}")

    if best_score < threshold:
        return False, None

    x, y, w, h = best_box
    return True, (x, y, w, h, best_score)


def random_touch(x, y, w, h, margin=0.2):
    mx = int(w * margin)
    my = int(h * margin)

    rx = random.randint(x + mx, x + w - mx)
    ry = random.randint(y + my, y + h - my)

    time.sleep(random.uniform(0.05, 0.15))

    adb_cmd(["adb", "shell", "input", "tap", str(rx), str(ry)])
    log.info(f"Touch ({rx}, {ry})")


def start_app(time_sleep):
    adb_cmd(["adb", "shell", "monkey", "-p", PKG_NAME, "1"])
    log.info(f"Start app, wait {time_sleep}s for starting")
    time.sleep(time_sleep)


def close_app():
    adb_cmd(["adb", "shell", "am", "force-stop", PKG_NAME])
    log.info("Close app")


def clear_data():
    log.info("Clear app data (Root & Communicate)")
    cmd = ["adb", "shell", f"su -c 'rm -rf /data/data/{PKG_NAME}/*'"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    stdout, stderr = p.communicate()
    if p.returncode == 0:
        log.info("Data cleared successfully.")
    else:
        log.error(f"Error clearing data: {stderr}")
    time.sleep(1)


def wait_for_stability(threshold=0.98, timeout=5):
    """Đợi cho đến khi màn hình ngừng thay đổi (hết animation)"""
    start_time = time.time()
    prev_frame = screen_cap()
    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    
    while time.time() - start_time < timeout:
        time.sleep(0.3)
        curr_frame = screen_cap()
        curr_gray = cv2.cvtColor(curr_frame, cv2.COLOR_BGR2GRAY)
        
        res = cv2.matchTemplate(curr_gray, prev_gray, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, _ = cv2.minMaxLoc(res)
        
        if max_val >= threshold:
            return True
        
        prev_gray = curr_gray
    return False

def step_detected(step, rate=2, timeout=60, threshold=0.8):
    if step in (4, 24, 25, 26):
        threshold = 0.5
    template_path = f"./step_img/step_dectec/step_{step}.png"
    if not os.path.exists(template_path):
        return False, None, 0

    template = cv2.imread(template_path)
    start_wait = time.perf_counter()

    while (time.perf_counter() - start_wait) < timeout:
        frame = screen_cap()
        matched, _ = find_sub_image(frame, template, threshold)
        elapsed = time.perf_counter() - start_wait
        
        if matched:
            if wait_for_stability(0.93, 1.5):
                return True, frame, elapsed
        time.sleep(rate)

    return False, None, (time.perf_counter() - start_wait)


def click_button(btn_path, frame, is_random=True):
    if not os.path.exists(btn_path):
        log.warning(f"File not found: {btn_path}")
        return False

    btn = cv2.imread(btn_path)
    found, result = find_sub_image(frame, btn, threshold=0.7)

    if not found:
        log.info(
            f"Button not found on old frame, retrying with fresh screenshot..."
        )
        new_frame = screen_cap()
        found, result = find_sub_image(new_frame, btn, threshold=0.7)

    if not found:
        log.info(
            f"Button still not found on old frame, retrying with continue button"
        )
        skip_btn = cv2.imread("./step_img/img_elements/click_to_continue_btn.png")
        found, result = find_sub_image(screen_cap(), skip_btn, threshold=0.7)

    if found:
        x, y, w, h, score = result
        log.info(f"Button {os.path.basename(btn_path)} score={score:.3f}")
        if is_random:
            random_touch(x, y, w, h)
        else:
            cx, cy = x + (w // 2), y + (h // 2)
            random_touch(cx - 1, cy - 1, 2, 2, margin=0)
        return True
    else:
        log.warning(f"Button STILL not found: {btn_path}")
        return False


def delete_text(length=15):
    log.info(f"Deleting {length} characters")
    cmd = ["adb", "shell", f"for i in {{1..{length}}}; do input keyevent 67; done"]
    subprocess.run(
        cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    time.sleep(5)


def send_text(text):
    text_processed = text.replace(" ", "%s")
    log.info(f"Sending text: {text}")
    adb_cmd(["adb", "shell", "input", "text", text_processed])


def get_random_text():
    letters = [random.choice(string.ascii_letters) for _ in range(4)]
    digits = [random.choice(string.digits) for _ in range(4)]
    combined = letters + digits
    random.shuffle(combined)
    return "".join(combined)

def get_smart_timeout(step):
    history = STEP_PERFORMANCE_DATA.get(step, [])
    if not history:
        return DEFAULT_TIMEOUT
    avg_time = sum(history) / len(history)
    smart_timeout = int(avg_time * BUFFER_PERCENT)
    return max(MIN_TIMEOUT, min(MAX_TIMEOUT, smart_timeout))

def step_action(step, frame, current_invite_code):
    confirm_btn = "./step_img/img_elements/comfirm_btn.png"
    click_to_continue_btn = "./step_img/img_elements/click_to_continue_btn.png"
    oke_btn = "./step_img/img_elements/oke_btn.png"
    back_btn = "./step_img/img_elements/back_btn.png"

    t_heavy = 15
    t_slow = 5
    t_light = 0.5
    t_default = 2
    match step:
        case 1:
            click_button("./step_img/img_elements/step1_button_1.png", frame)
            time.sleep(t_slow)

        case 2:
            click_button("./step_img/img_elements/step2_button_1.png", frame, False)

        case 3:
            click_button(
                "./step_img/img_elements/step3_button_1.png", frame, is_random=False
            )
            
            crawl.start_crawl()
            crawl.email_crawl(send_text)
            click_button(oke_btn, screen_cap())
            click_button(
                "./step_img/img_elements/step3_button_2.png", frame, is_random=False
            )
            time.sleep(t_heavy)

        case 4:
                log.info("Đang xử lý Step 4: Cắt ảnh Captcha và kéo (Tối đa 5 lần retry)...")
                captcha_success = False
                
                for attempt in range(1, 6):  # Thử tối đa 5 lần
                    log.info(f"--- Thử giải Captcha lần {attempt}/5 ---")
                    curr_frame = screen_cap()
                    
                    # 1. Tìm vị trí 2 điểm mốc
                    img_p1 = cv2.imread("./step_img/img_elements/step4_point_1.png")
                    img_p2 = cv2.imread("./step_img/img_elements/step4_point_2.png")

                    found1, res1 = find_sub_image(curr_frame, img_p1, threshold=0.7)
                    found2, res2 = find_sub_image(curr_frame, img_p2, threshold=0.7)

                    # Nếu không thấy 1 trong 2 điểm mốc, có thể captcha đã biến mất hoặc giải xong
                    if not (found1 and found2):
                        log.info("Không còn thấy Point 1 hoặc Point 2 trên màn hình. Thoát vòng lặp Captcha.")
                        # Kiểm tra xem có phải đã giải xong và hiện nút kế tiếp không
                        if click_button("./step_img/img_elements/step4_button_2.png", screen_cap()):
                            captcha_success = True
                        break

                    x1, y1, w1, h1, _ = res1
                    x2, y2, w2, h2, _ = res2

                    # 2. Xác định vùng cắt (ROI)
                    crop_y_start = y1 + h1
                    crop_y_end = y2
                    crop_x_start = x1
                    crop_x_end = x1 + w1

                    if crop_y_end > crop_y_start and crop_x_end > crop_x_start:
                        captcha_roi = curr_frame[crop_y_start:crop_y_end, crop_x_start:crop_x_end]
                        
                        # 3. Gửi ảnh lên giải captcha
                        rel_coords = solve_slide_captcha(captcha_roi)
                        
                        if rel_coords:
                            target_rel_x, _ = rel_coords
                            screen_target_x = int(crop_x_start + target_rel_x)
                            
                            # 4. Tọa độ kéo
                            start_x = int(x2 + (w2 / 2)) - 7
                            start_y = int(y2 + (h2 / 2))
                            end_x = screen_target_x
                            end_y = start_y 

                            log.info(f"Kéo từ ({start_x}, {start_y}) tới X={end_x}")
                            
                            # 5. Thực hiện swipe
                            duration = random.randint(1200, 1800)
                            adb_cmd(["adb", "shell", "input", "swipe", 
                                    str(start_x), str(start_y), 
                                    str(end_x), str(end_y), 
                                    str(duration)])
                            
                            time.sleep(4)  # Đợi hiệu ứng trượt và check kết quả
                            
                            # Kiểm tra nếu sau khi kéo đã xuất hiện nút "Gửi mã" (step4_button_2)
                            if click_button("./step_img/img_elements/step4_button_2.png", screen_cap()):
                                log.info("Giải Captcha thành công ở lần thử này!")
                                captcha_success = True
                                break
                        else:
                            log.warning(f"AI không tìm thấy lỗ hổng ở lần thử {attempt}")
                    
                    log.info(f"Lần thử {attempt} thất bại hoặc Captcha chưa mất, chuẩn bị thử lại...")
                    time.sleep(2) # Nghỉ ngắn trước khi scan lại

                # Sau khi thoát vòng lặp (do thành công hoặc hết lượt)
                if captcha_success:
                    # Thực hiện các bước hậu Captcha
                    crawl.code_crawl(send_text)
                    crawl.end_task()
                    click_button(oke_btn, screen_cap())
                    click_button("./step_img/img_elements/step4_button_3.png", screen_cap())
                else:
                    log.error("Đã thử 5 lần nhưng không giải được Captcha.")

        case 5:
            click_button("./step_img/img_elements/step5_button_1.png", frame, False)
            click_button("./step_img/img_elements/step5_button_2.png", frame)
            time.sleep(t_slow)

        case 6:
            click_button("./step_img/img_elements/step6_button_1.png", frame, False)
            send_text(get_random_text())
            click_button(oke_btn, screen_cap())
            click_button(confirm_btn, screen_cap())
            time.sleep(t_slow)
        case 7:
            click_button("./step_img/img_elements/step7_button_1.png", frame)
            click_button(confirm_btn, frame)

        case 8:
            click_button(click_to_continue_btn, frame)
            click_button("./step_img/img_elements/step8_button_1.png", frame)

        case 9:
            click_button("./step_img/img_elements/step9_button_1.png", frame)

        case 10:
            click_button(confirm_btn, frame)
            time.sleep(t_heavy)

        case 11:
            click_button("./step_img/img_elements/step11_button_1.png", frame, False)
            click_button(confirm_btn, screen_cap())
            time.sleep(t_light)
            click_button(click_to_continue_btn, frame)
            click_button(click_to_continue_btn, frame)

        case 12:
            click_button("./step_img/img_elements/step12_button_1.png", frame, False)

        case 13:
            click_button(click_to_continue_btn, frame)
            time.sleep(t_light)
            click_button("./step_img/img_elements/step13_button_1.png", screen_cap(), False)
            time.sleep(t_light)
            click_button(click_to_continue_btn, screen_cap())

        case 14:
            click_button("./step_img/img_elements/step14_button_1.png", frame, False)

        case 15:
            click_button("./step_img/img_elements/step15_button_1.png", frame, False)

        case 16:
            click_button(back_btn, frame, False)
            time.sleep(t_default)

        case 17:
            click_button("./step_img/img_elements/step17_button_1.png", frame, False)
            click_button(click_to_continue_btn, screen_cap())

        case 18:
            click_button("./step_img/img_elements/step18_button_1.png", frame)
            time.sleep(t_default)
        case 19:
            click_button(back_btn, frame)

        case 20:
            click_button(back_btn, frame)
            time.sleep(t_light)
            click_button(click_to_continue_btn, screen_cap())
            time.sleep(t_light)
            click_button(click_to_continue_btn, screen_cap())

        case 21:
            click_button(back_btn, frame)
            time.sleep(t_light)
            click_button(click_to_continue_btn, screen_cap())
            time.sleep(t_light)

        case 22:
            click_button("./step_img/img_elements/step22_button_1.png", frame)
            time.sleep(t_light)
            click_button("./step_img/img_elements/step22_button_2.png", frame)
            time.sleep(t_light)

        case 23:
            click_button("./step_img/img_elements/step23_button_1.png", frame)
            time.sleep(t_default)
            exp_dect = cv2.imread("./step_img/img_elements/step23_button_2.png")
            found, res = find_sub_image(screen_cap(), exp_dect)
            click_button(confirm_btn, screen_cap())
            click_button(back_btn, frame)
            time.sleep(t_default)
            click_button("./step_img/img_elements/step22_button_1.png", screen_cap())
            if not found:
                return 30

            click_button("./step_img/img_elements/step12_button_1.png", screen_cap())  

        case 24:
            time.sleep(t_light)
            is_click = click_button("./step_img/img_elements/step24_button_2.png", screen_cap(), False)
            if not is_click:
                time.sleep(t_light)
                click_button("./step_img/img_elements/step24_button_1.png", screen_cap())
                return 24
            
        case 25:
            has_clicked_any = False

            while True:
                # Thử bấm lần lượt nút 1 -> 2 -> 3
                is_clicked = False

                if click_button("./step_img/img_elements/step25_button_1.png", screen_cap(), False):
                    is_clicked = True
                elif click_button("./step_img/img_elements/step25_button_2.png", screen_cap(), False):
                    is_clicked = True
                elif click_button("./step_img/img_elements/step25_button_3.png", screen_cap(), False):
                    is_clicked = True

                # Nếu không bấm được nút nào nữa → thoát vòng lặp
                if not is_clicked:
                    break

                has_clicked_any = True

                # Bấm nút 4, nếu không có thì bấm nút 5
                time.sleep(t_light)
                if not click_button("./step_img/img_elements/step25_button_4.png", screen_cap(), False):
                    click_button("./step_img/img_elements/step25_button_5.png", screen_cap(), False)

                time.sleep(t_light)
                click_button(confirm_btn, screen_cap())

                # có thể thêm sleep nhẹ nếu UI load chậm
                time.sleep(t_default)

            # Sau khi lặp xong
            if not has_clicked_any:
                click_button(back_btn, frame)
                return 30

        case 26:
            click_button(back_btn, screen_cap())
            time.sleep(t_light)
            
        case 27:
            click_button("./step_img/img_elements/step27_button_1.png", frame)
            
        case 28:
            click_button("./step_img/img_elements/step28_button_1.png", frame)

        case 29:
            click_button("./step_img/img_elements/step29_button_1.png", frame, False)
            time.sleep(t_light)
            send_text(current_invite_code)
            time.sleep(t_light)
            click_button(oke_btn, screen_cap())
            save_result(screen_cap(), "29.1", current_invite_code, status="SUCCESS")
            time.sleep(t_light)
            click_button("./step_img/img_elements/step29_button_2.png", frame, False)
            save_result(screen_cap(), "29.2", current_invite_code, status="SUCCESS")
            click_button(back_btn, screen_cap())
            time.sleep(t_light)

        case 30:
            # click_button("./step_img/img_elements/step22_button_1.png", frame, False)
            # time.sleep(t_light)
            click_button("./step_img/img_elements/step30_button_1.png", frame, False)
            time.sleep(t_light)
            click_button("./step_img/img_elements/step30_button_2.png", screen_cap(), False)
            time.sleep(t_light)

        case 31:
            click_button("./step_img/img_elements/step31_button_1.png", frame, False)
            time.sleep(t_light)
            click_button(confirm_btn, screen_cap())
            time.sleep(t_heavy)

        case _:
            log.warning(f"Step {step} no action defined.")


def save_result(img, loop_index, code, status="result"):
    folder = "out_img"
    if not os.path.exists(folder):
        os.makedirs(folder)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"{folder}/{status}_{code}_{loop_index}_{timestamp}.png"
    if img is not None:
        cv2.imwrite(filename, img)
        log.info(f"Saved: {filename}")


# ================== MAIN BOT ==================
# Z:\my_tools\android_tools\cfl_invite_event\step_img\step_dectec
def identify_current_step(threshold=0.7):
    frame = screen_cap()
    for step in range(0, TOTAL_STEP, 1):
        template_path = f"./step_img/step_dectec/step_{step}.png"
        if os.path.exists(template_path):
            template = cv2.imread(template_path)
            matched, score = detect_match(frame, template, threshold)
            if matched:
                return step, frame
    return None, None

def run_auto_bot(invite_code, iterations):
    loop_idx = 0
    # close_app()
    # clear_data()
    # start_app(START_TIME)
    while loop_idx < iterations:
        start_run_time = time.perf_counter()
        log.info(f"--- STARTING CODE: {invite_code} | LOOP {loop_idx+1}/{iterations} ---")
        
        current_step = 1
        fail_count = 0
        status = "FAILED"
        loop_timed_out = False

        while current_step <= TOTAL_STEP:
            elapsed_total = time.perf_counter() - start_run_time
            if elapsed_total > MAX_LOOP_DURATION:
                log.error(f"!!! LOOP TIMEOUT !!! Đã chạy {elapsed_total:.1f}s. Vượt giới hạn {MAX_LOOP_DURATION}s. Khởi động lại...")
                status = "TOTAL_TIMEOUT"
                loop_timed_out = True
                break

            current_timeout = get_smart_timeout(current_step)
            detected, frame, elapsed = step_detected(current_step, rate=2, timeout=current_timeout, threshold=0.5)

            if detected:
                if current_step not in STEP_PERFORMANCE_DATA:
                    STEP_PERFORMANCE_DATA[current_step] = []
                STEP_PERFORMANCE_DATA[current_step].append(elapsed)
                
                jump_step = step_action(current_step, frame, invite_code)
                
                if current_step == TOTAL_STEP and jump_step is None:
                    status = "SUCCESS"
                    break
                
                if isinstance(jump_step, (int, float)):
                    log.info(f"Cơ chế nhảy step kích hoạt: Từ {current_step} nhảy đến {jump_step}")
                    current_step = int(jump_step)
                    time.sleep(2)
                else:
                    current_step += 1
                
                fail_count = 0
            else:
                log.warning(f"Timeout step {current_step}. Syncing...")
                found_step, found_frame = identify_current_step()
                if found_step:
                    current_step = found_step
                    fail_count = 0
                else:
                    fail_count += 1
                    if fail_count >= 5:
                        save_result(screen_cap(), loop_idx, invite_code, status="FAILED_UNKNOWN")
                        break
                    time.sleep(5)

        total_duration = time.perf_counter() - start_run_time
        mins, secs = divmod(total_duration, 60)
        log.info(f"===> LOOP {loop_idx+1} FINISHED [{status}] | Time: {int(mins)}m {int(secs)}s")
        time.sleep(2)

        if not loop_timed_out:
            loop_idx += 1
        else:
            log.info("Retrying the same loop index due to total timeout...")

# run_auto_bot(INVITE_CODES[0], LOOPS_PER_CODE)

if __name__ == "__main__":
    try:
        log.info("Starting Auto Bot...")
        for code in INVITE_CODES:
            log.info(f"RUNNING FOR INVITE CODE: {code}")
            run_auto_bot(code, LOOPS_PER_CODE)
            log.info(f"DONE ALL LOOPS FOR CODE: {code}")
            time.sleep(5)

        log.info("ALL CODES PROCESSED.")
    except KeyboardInterrupt:
        log.info("Stopped by user")
    except Exception as e:
        close_app()
        log.error(f"Fatal error: {str(e)}")
        input("Press Enter to exit...")