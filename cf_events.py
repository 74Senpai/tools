import subprocess
import time
import numpy as np
import cv2
import logging
import random
import os
import string

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)

PKG_NAME = "com.tencent.stc.cfl"

INVITE_CODES = [
    "HQLHTVKRQ",
    "EHVXLHNJN",
]

LOOPS_PER_CODE = 25


def adb_cmd(cmd):
    return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


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
    large_img, small_img, threshold=0.7, scales=(0.8, 0.9, 1.0, 1.1, 1.2)
):
    if large_img is None or small_img is None:
        return False, None

    large_gray = cv2.cvtColor(large_img, cv2.COLOR_BGR2GRAY)
    small_gray = cv2.cvtColor(small_img, cv2.COLOR_BGR2GRAY)

    best_score = 0.0
    best_box = None

    for s in scales:
        resized = cv2.resize(
            small_gray, None, fx=s, fy=s, interpolation=cv2.INTER_LINEAR
        )

        if (
            resized.shape[0] > large_gray.shape[0]
            or resized.shape[1] > large_gray.shape[1]
        ):
            continue

        result = cv2.matchTemplate(large_gray, resized, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)

        if max_val > best_score:
            best_score = max_val
            x, y = max_loc
            h, w = resized.shape[:2]
            best_box = (x, y, w, h)

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
    logging.info(f"Touch ({rx}, {ry})")


def start_app(time_sleep):
    adb_cmd(["adb", "shell", "monkey", "-p", PKG_NAME, "1"])
    logging.info(f"Start app, wait {time_sleep}s for starting")
    time.sleep(time_sleep)


def close_app():
    adb_cmd(["adb", "shell", "am", "force-stop", PKG_NAME])
    logging.info("Close app")


def clear_data():
    logging.info("Clear app data (Root & Communicate)")
    cmd = ["adb", "shell", f"su -c 'rm -rf /data/data/{PKG_NAME}/*'"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    stdout, stderr = p.communicate()
    if p.returncode == 0:
        logging.info("Data cleared successfully.")
    else:
        logging.error(f"Error clearing data: {stderr}")
    time.sleep(1)


def step_detected(step, rate=2, timeout=60, threshold=0.7):
    template_path = f"./step_img/step{step}.png"
    if not os.path.exists(template_path):
        logging.error(f"Template not found: {template_path}")
        return False, None

    template = cv2.imread(template_path)
    start = time.time()

    while time.time() - start < timeout:
        frame = screen_cap()
        matched, score = detect_match(frame, template, threshold)
        logging.info(f"Step {step} score={score:.3f}")
        if matched:
            logging.info(f"Detected step {step}")
            return True, frame
        time.sleep(rate)

    logging.error(f"Timeout step {step}")
    return False, None


def click_button(btn_path, frame, is_random=True):
    if not os.path.exists(btn_path):
        logging.warning(f"File not found: {btn_path}")
        return False

    btn = cv2.imread(btn_path)
    found, result = find_sub_image(frame, btn, threshold=0.7)

    if not found:
        logging.info(
            f"Button not found on old frame, retrying with fresh screenshot..."
        )
        time.sleep(0.5)
        new_frame = screen_cap()
        found, result = find_sub_image(new_frame, btn, threshold=0.7)

    if found:
        x, y, w, h, score = result
        logging.info(f"Button {os.path.basename(btn_path)} score={score:.3f}")
        if is_random:
            random_touch(x, y, w, h)
        else:
            cx, cy = x + (w // 2), y + (h // 2)
            random_touch(cx - 1, cy - 1, 2, 2, margin=0)
        time.sleep(0.5)
        return True
    else:
        logging.warning(f"Button STILL not found: {btn_path}")
        return False


def delete_text(length=15):
    logging.info(f"Deleting {length} characters")
    cmd = ["adb", "shell", f"for i in {{1..{length}}}; do input keyevent 67; done"]
    subprocess.run(
        cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


def send_text(text):
    text_processed = text.replace(" ", "%s")
    logging.info(f"Sending text: {text}")
    adb_cmd(["adb", "shell", "input", "text", text_processed])


def get_random_text():
    letters = [random.choice(string.ascii_letters) for _ in range(4)]
    digits = [random.choice(string.digits) for _ in range(4)]
    combined = letters + digits
    random.shuffle(combined)
    return "".join(combined)


def step_action(step, frame, current_invite_code):
    confirm_btn = "./step_img/img_elements/comfirm_btn.png"
    click_to_continue_btn = "./step_img/img_elements/click_to_continue_btn.png"
    oke_btn = "./step_img/img_elements/oke_btn.png"

    t_heavy = 15
    t_slow = 5
    t_light = 0.5
    t_default = 2

    match step:
        case 1:
            click_button("./step_img/img_elements/step1_button_1.png", frame)

        case 2:
            click_button("./step_img/img_elements/step2_button_1.png", frame, False)

        case 3:
            click_button(
                "./step_img/img_elements/step3_button_1.png", frame, is_random=False
            )
            time.sleep(t_light)

        case 4:
            click_button("./step_img/img_elements/step4_button_1.png", frame, False)

        case 5:
            click_button("./step_img/img_elements/step5_button_1.png", frame)
            time.sleep(t_light)
            delete_text()
            time.sleep(t_default)
            send_text(get_random_text())
            time.sleep(1)
            click_button(oke_btn, screen_cap())
            click_button(confirm_btn, screen_cap())
            time.sleep(t_light)

        case 6:
            click_button("./step_img/img_elements/step6_button_1.png", frame)
            click_button(confirm_btn, screen_cap())
            time.sleep(t_heavy)

        case 7:
            click_button(click_to_continue_btn, frame)

        case 8:
            click_button("./step_img/img_elements/step8_button_1.png", frame)

        case 9:
            click_button("./step_img/img_elements/step9_button_1.png", frame)

        case 10:
            click_button(confirm_btn, frame)
            time.sleep(t_heavy)

        case 11:
            click_button("./step_img/img_elements/step11_button_1.png", frame)
            click_button(confirm_btn, screen_cap())

        case 12:
            click_button(click_to_continue_btn, frame)
            time.sleep(t_light)
            click_button(click_to_continue_btn, frame)

        case 13:
            click_button("./step_img/img_elements/step13_button_1.png", frame, False)

        case 14:
            click_button(click_to_continue_btn, frame)

        case 15:
            click_button("./step_img/img_elements/step15_button_1.png", frame)
            click_button(click_to_continue_btn, screen_cap())
            click_button("./step_img/img_elements/step15_button_2.png", screen_cap())

        case 16:
            click_button("./step_img/img_elements/step16_button_1.png", frame)

        case 17:
            click_button("./step_img/img_elements/step17_button_1.png", frame)

        case 18:
            click_button("./step_img/img_elements/step18_button_1.png", frame)

        case 19:
            click_button(click_to_continue_btn, frame)
            click_button("./step_img/img_elements/step19_button_1.png", frame, False)

        case 20:
            click_button("./step_img/img_elements/step20_button_1.png", frame)

        case 21:
            click_button("./step_img/img_elements/step21_button_1.png", frame, False)
            click_button(click_to_continue_btn, frame)
        case 22:
            click_button(click_to_continue_btn, frame)
            click_button("./step_img/img_elements/step22_button_1.png", frame)
            time.sleep(t_light)
            click_button(click_to_continue_btn, frame)
        case 23:
            is_click = click_button(
                "./step_img/img_elements/step23_button_1.png", frame
            )
            if not is_click:
                click_button(click_to_continue_btn, frame)
                is_click = click_button(
                    "./step_img/img_elements/step23_button_1.png", frame, False
                )

        case 24:
            click_button("./step_img/img_elements/step24_button_1.png", frame)

        case 25:
            is_click = click_button(
                "./step_img/img_elements/step25_button_1.png", frame
            )
            if not is_click:
                click_button("./step_img/img_elements/step25_button_2.png", frame)
        case 26:
            click_button(
                "./step_img/img_elements/step26_button_1.png", frame, is_random=False
            )

        case 27:
            click_button("./step_img/img_elements/step27_button_1.png", frame)
            time.sleep(t_light)
            # Dung current_invite_code tu tham so truyen vao
            send_text(current_invite_code)
            time.sleep(1)
            click_button(oke_btn, screen_cap())

        case 28:
            click_button("./step_img/img_elements/step28_button_1.png", frame)
            time.sleep(t_default)

        case _:
            logging.warning(f"Step {step} no action defined.")


def save_result(img, loop_index, code, status="result"):
    folder = "out_img"
    if not os.path.exists(folder):
        os.makedirs(folder)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"{folder}/{status}_{code}_loop_{loop_index+1}_{timestamp}.png"
    if img is not None:
        cv2.imwrite(filename, img)
        logging.info(f"Saved: {filename}")


# ================== MAIN BOT ==================
def run_auto_bot(invite_code, iterations):
    for n in range(iterations):
        logging.info(f"--- STARTING CODE: {invite_code} | LOOP {n+1}/{iterations} ---")
        close_app()
        clear_data()
        start_app(60)

        success_all_steps = True

        for step in range(1, 29):
            detected, frame = step_detected(step, rate=2, timeout=90)
            if detected:
                step_action(step, frame, invite_code)
                time.sleep(3)

                if step == 28:
                    time.sleep(5)
                    final_frame = screen_cap()
                    save_result(final_frame, n, invite_code, status="SUCCESS")
            else:
                logging.error(f"Failed at step {step}. Taking error screenshot...")
                error_frame = screen_cap()
                save_result(error_frame, n, invite_code, status="FAILED")
                success_all_steps = False
                break

        if success_all_steps:
            logging.info(f"Finished loop {n+1} for code {invite_code} successfully.")

        close_app()
        time.sleep(2)


if __name__ == "__main__":
    try:
        logging.info("Starting Auto Bot...")
        for code in INVITE_CODES:
            logging.info(f"RUNNING FOR INVITE CODE: {code}")
            run_auto_bot(code, LOOPS_PER_CODE)
            logging.info(f"DONE ALL LOOPS FOR CODE: {code}")
            time.sleep(5)

        logging.info("ALL CODES PROCESSED.")
    except KeyboardInterrupt:
        logging.info("Stopped by user")
    except Exception as e:
        close_app()
        logging.error(f"Fatal error: {str(e)}")
        input("Press Enter to exit...")
