#!/bin/sh
# Created by Cory McCabe
set -eu
task_source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
task_bundle_dir="${HOME}/Applications/Followthrough Codex.app"
mkdir -p "${task_bundle_dir}/Contents/MacOS"
cp "${task_source_dir}/Info.plist" "${task_bundle_dir}/Contents/Info.plist"
xcrun swiftc -parse-as-library -swift-version 5 -module-cache-path /private/tmp/followthrough-swift-cache "${task_source_dir}/FollowthroughCodex.swift" "${task_source_dir}/QueueRunner.swift" -o "${task_bundle_dir}/Contents/MacOS/FollowthroughCodex"
codesign --force --sign - "${task_bundle_dir}"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${task_bundle_dir}"
task_agent_dir="${HOME}/Library/LaunchAgents"
task_agent_path="${task_agent_dir}/com.corymccabe.followthrough-codex.plist"
mkdir -p "${task_agent_dir}"
cat > "${task_agent_path}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Created by Cory McCabe -->
<plist version="1.0"><dict><key>Label</key><string>com.corymccabe.followthrough-codex</string><key>ProgramArguments</key><array><string>${task_bundle_dir}/Contents/MacOS/FollowthroughCodex</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>ProcessType</key><string>Interactive</string></dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/com.corymccabe.followthrough-codex" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${task_agent_path}"
printf '%s\n' "Installed: ${task_bundle_dir}"
