# PyInstaller runtime hook: load OpenCV's compiled module directly.
# OpenCV's own cv2/__init__.py removes itself and imports cv2 again, expecting to find the compiled module the second time.
# Inside a Mac app bundle it finds the same __init__.py instead and stops with "recursion is detected during loading of
# cv2 binary extensions". Everything Opia uses from OpenCV lives in the compiled module, so loading that is enough.
import glob
import importlib.util
import os
import sys

_found = sorted(glob.glob(os.path.join(getattr(sys, '_MEIPASS', ''), 'cv2', 'cv2*.so')))
if _found:
    _spec = importlib.util.spec_from_file_location('cv2', _found[0])
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules['cv2'] = _mod
    try:
        _spec.loader.exec_module(_mod)
    except Exception:
        del sys.modules['cv2']       # fall back to OpenCV's own loader
