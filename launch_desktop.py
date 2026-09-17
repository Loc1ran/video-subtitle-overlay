import os
import sys
import time
import subprocess
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8000
URL = f"http://localhost:{PORT}"

def is_server_running():
    try:
        with urllib.request.urlopen(f"{URL}/api/languages", timeout=1) as response:
            return response.status == 200
    except Exception:
        return False

def start_server():
    if not is_server_running():
        print("Starting Video Subtitle Studio backend server...")
        # Start server as a background process
        subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
            cwd=BASE_DIR,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        )
        for _ in range(20):
            time.sleep(0.5)
            if is_server_running():
                break

def open_desktop_window():
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    edge_exe = next((p for p in edge_paths if os.path.exists(p)), None)
    
    if edge_exe:
        # Launch standalone app window
        subprocess.Popen([edge_exe, f"--app={URL}", "--window-size=1400,900"])
    else:
        import webbrowser
        webbrowser.open(URL)

if __name__ == "__main__":
    start_server()
    open_desktop_window()
