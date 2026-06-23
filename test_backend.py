"""Minimal macOS-port checks for dictation_backend.

Run from the repo root with the same Python the extension uses:
    python test_backend.py
"""
import importlib
import sys


def test_paste_modifier_and_keyboard_guard():
    mod = importlib.import_module("dictation_backend")
    if sys.platform == "darwin":
        assert mod.PASTE_MODIFIER == "command", mod.PASTE_MODIFIER
        assert mod.IS_WINDOWS is False
        assert mod.keyboard is None, "the `keyboard` lib must NOT be imported off Windows"
    elif sys.platform == "win32":
        assert mod.PASTE_MODIFIER == "ctrl"
        assert mod.IS_WINDOWS is True
    else:  # linux
        assert mod.PASTE_MODIFIER == "ctrl"
        assert mod.IS_WINDOWS is False
        assert mod.keyboard is None


if __name__ == "__main__":
    test_paste_modifier_and_keyboard_guard()
    print("OK")
