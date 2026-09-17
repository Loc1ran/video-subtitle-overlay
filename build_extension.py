import os
import shutil

base_dir = os.path.dirname(os.path.abspath(__file__))
ext_dir = os.path.join(base_dir, "subtitle-ai-extension")

# Ensure overlay.css is blank (widget-free)
with open(os.path.join(ext_dir, "overlay.css"), "w", encoding="utf-8") as f:
    f.write("/* Widget-free edition: No injected on-page styles */\n")

print("[BUILD] Extension synchronized: Widget-free edition ready in subtitle-ai-extension/")
