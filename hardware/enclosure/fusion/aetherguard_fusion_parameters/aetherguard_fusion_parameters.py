"""Create AetherGuard enclosure user parameters in Autodesk Fusion."""

import pathlib
import runpy


def run(context):
    script_path = pathlib.Path(__file__).resolve().parent.parent / "aetherguard_fusion_parameters.py"
    namespace = runpy.run_path(str(script_path))
    namespace["run"](context)


def stop(context):
    pass
