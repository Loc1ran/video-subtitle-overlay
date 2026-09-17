import os
import sys
import time
import socket
import threading
import subprocess
import webbrowser
import urllib.request
import logging
import uvicorn

class SanitizeLogFilter(logging.Filter):
    def filter(self, record):
        if "Will watch for changes" in record.getMessage():
            return False
        return True

logging.getLogger("uvicorn.error").addFilter(SanitizeLogFilter())

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
os.chdir(BASE_DIR)

PORT = 8000
URL = f"http://127.0.0.1:{PORT}"

def is_server_ready():
    try:
        with urllib.request.urlopen(f"{URL}/api/languages", timeout=1) as res:
            return res.status == 200
    except Exception:
        return False

def kill_process_on_port(port: int):
    """If an orphaned process is listening on the target port, terminate it."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return

        print(f"[!] Port {port} is occupied. Cleaning up previous instance...", flush=True)
        cmd = f'netstat -ano -p tcp | findstr ":{port}"'
        output = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL)
        pids = set()
        for line in output.strip().splitlines():
            parts = line.split()
            if len(parts) >= 5 and f":{port}" in parts[1] and parts[3].upper() == "LISTENING":
                pid = parts[4]
                if pid.isdigit() and int(pid) != os.getpid() and int(pid) != 0:
                    pids.add(pid)

        for pid in pids:
            print(f"[CLEANUP] Terminating previous process PID {pid}...", flush=True)
            subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True)

        time.sleep(1.5)
    except Exception as e:
        print(f"[DEBUG] Port check note: {e}", flush=True)

def open_browser_when_ready():
    """Background thread that waits for server to become responsive, then opens browser."""
    for _ in range(60):
        time.sleep(0.5)
        if is_server_ready():
            print(flush=True)
            print("=======================================================", flush=True)
            print(f"[SUCCESS] Video Subtitle Studio is running at: {URL}", flush=True)
            print("Opening your browser...", flush=True)
            print("NOTE: Keep this terminal window open while using the app!", flush=True)
            print("Press Ctrl+C in this terminal window to stop the server.", flush=True)
            print("=======================================================", flush=True)
            print(flush=True)
            webbrowser.open(URL)
            return

def main():
    print("=======================================================", flush=True)
    print("              VIDEO SUBTITLE STUDIO", flush=True)
    print("=======================================================", flush=True)
    print(flush=True)

    # Free up port if an orphaned process from a previous run is lingering
    kill_process_on_port(PORT)

    print(f"Starting server at {URL}...", flush=True)
    print("Loading AI speech & OCR models...", flush=True)

    # Start background watcher to launch browser once server is responsive
    browser_thread = threading.Thread(target=open_browser_when_ready, daemon=True)
    browser_thread.start()

    try:
        # Run uvicorn directly in this process so:
        # 1. Logs stream in real time to the terminal window
        # 2. Window stays open and visible
        # 3. Ctrl+C or closing window cleanly terminates the server
        use_reload = "--reload" in sys.argv
        if use_reload:
            uvicorn.run(
                "app.main:app",
                host="127.0.0.1",
                port=PORT,
                log_level="info",
                reload=True,
                reload_dirs=[os.path.join(BASE_DIR, "app")]
            )
        else:
            uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, log_level="info")
    except (KeyboardInterrupt, SystemExit):
        print("\n[INFO] Video Subtitle Studio server stopped.", flush=True)

if __name__ == "__main__":
    main()
