#!/bin/sh
# Created by Cory McCabe
set -eu
task_source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
task_bundle_dir="${HOME}/Applications/Followthrough Codex.app"
mkdir -p "${task_bundle_dir}/Contents/MacOS"
cp "${task_source_dir}/Info.plist" "${task_bundle_dir}/Contents/Info.plist"
xcrun swiftc -parse-as-library -swift-version 5 -module-cache-path /private/tmp/followthrough-swift-cache "${task_source_dir}/FollowthroughCodex.swift" -o "${task_bundle_dir}/Contents/MacOS/FollowthroughCodex"
codesign --force --sign - "${task_bundle_dir}"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${task_bundle_dir}"
printf '%s\n' "Installed: ${task_bundle_dir}"
