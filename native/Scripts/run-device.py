#!/usr/bin/env python3
# Created by Cory McCabe
"""Install and launch an explicitly selected development build on a physical iPhone."""

import argparse
import os
from pathlib import Path
import plistlib
import subprocess


APP_ID = "dev.ethosapps.followthrough"
APP_GROUP = "group.dev.ethosapps.followthrough"
EXTENSION_IDS = {APP_ID + ".widgets", APP_ID + ".share"}


def validate_bundle(path: Path, expected_id: str | None = None) -> dict:
    with (path / "Info.plist").open("rb") as source:
        info = plistlib.load(source)
    bundle_id = info.get("CFBundleIdentifier")
    if expected_id is not None and bundle_id != expected_id:
        raise ValueError(f"Expected {expected_id}, found {bundle_id!r}.")
    if info.get("CFBundleSupportedPlatforms") != ["iPhoneOS"]:
        raise ValueError(f"{path.name} is not a physical iPhone build.")
    if info.get("FollowthroughAppGroup") != APP_GROUP:
        raise ValueError(f"{path.name} does not use the device app group.")
    executable = info.get("CFBundleExecutable")
    if not isinstance(executable, str) or not executable or Path(executable).name != executable:
        raise ValueError(f"{path.name} has an invalid executable name.")
    if not (path / executable).is_file():
        raise ValueError(f"{path.name} is missing its compiled executable.")
    if not (path / "embedded.mobileprovision").is_file():
        raise ValueError(f"{path.name} is missing its device provisioning profile.")
    return info


def validate_app(path: Path) -> None:
    if path.suffix != ".app" or not path.is_dir():
        raise ValueError("--app must point to a built physical-device .app directory.")
    info = validate_bundle(path, APP_ID)
    if info.get("CFBundleDisplayName") != "Followthrough":
        raise ValueError("The device app must be named Followthrough.")
    extensions = list((path / "PlugIns").glob("*.appex"))
    identifiers = [validate_bundle(extension).get("CFBundleIdentifier") for extension in extensions]
    if len(identifiers) != len(EXTENSION_IDS) or set(identifiers) != EXTENSION_IDS:
        raise ValueError("Expected the device widget and share extensions with distinct bundle IDs.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, help="Explicit connected iPhone identifier from devicectl.")
    parser.add_argument("--app", required=True, type=Path, help="Built Debug-iphoneos .app; never a simulator build.")
    parser.add_argument("--install-only", action="store_true", help="Install without launching the app.")
    args = parser.parse_args()
    app = args.app.expanduser().resolve()
    try:
        validate_app(app)
    except (OSError, ValueError, plistlib.InvalidFileException) as error:
        parser.error(str(error))

    # devicectl can forward DEVICECTL_CHILD_* implicitly. This launcher never
    # forwards app-specific environment values or reads local-session fixtures.
    environment = {
        key: value for key, value in os.environ.items()
        if not key.startswith(("DEVICECTL_CHILD_", "SIMCTL_CHILD_", "FOLLOWTHROUGH_"))
    }
    subprocess.run(
        ["xcrun", "devicectl", "device", "install", "app", "--device", args.device, str(app)],
        env=environment, check=True,
    )
    if not args.install_only:
        subprocess.run(
            ["xcrun", "devicectl", "device", "process", "launch", "--device", args.device, APP_ID],
            env=environment, check=True,
        )


if __name__ == "__main__":
    main()
