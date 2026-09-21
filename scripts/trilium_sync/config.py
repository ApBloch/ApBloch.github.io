"""Connection settings. The first run asks for them and saves them locally.

They are stored in config.local.json, which is gitignored: it holds your
ETAPI token, so it must never be committed. Environment variables
TRILIUM_URL, TRILIUM_TOKEN and TRILIUM_ROOT_NOTE_ID override the file.
"""
import getpass
import json
import os
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent / "config.local.json"
ENV = {"url": "TRILIUM_URL", "token": "TRILIUM_TOKEN", "root_note_id": "TRILIUM_ROOT_NOTE_ID"}


def load(path=CONFIG_PATH):
    cfg = {}
    if Path(path).is_file():
        cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    for key, var in ENV.items():
        if os.environ.get(var):
            cfg[key] = os.environ[var]
    return cfg


def save(cfg, path=CONFIG_PATH):
    Path(path).write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")


def ensure(cfg, ask=input, ask_secret=getpass.getpass, path=CONFIG_PATH):
    """Fill in anything missing by asking once, then remember the answers."""
    changed = False
    if not cfg.get("url"):
        cfg["url"] = ask("Trilium address (for example https://notes.example.com): ").strip()
        changed = True
    if not cfg.get("token"):
        cfg["token"] = ask_secret("ETAPI token (Trilium: Options > ETAPI; typing is hidden): ").strip()
        changed = True
    if changed:
        save({k: v for k, v in cfg.items() if v}, path)
        print("Saved to %s (gitignored)." % Path(path).name)
    return cfg
