#!/usr/bin/env python3
# Created by Cory McCabe
import os, subprocess, json, base64, argparse
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('platform',choices=['mac','ios']);p.add_argument('--simulator');p.add_argument('--no-session',action='store_true');p.add_argument('--ad-hoc',action='store_true');p.add_argument('--sign-identity',default='Apple Development: Cory McCabe (PB32N9RX37)');args=p.parse_args()
session=root/('local-session-ios.json' if args.platform=='ios' else 'local-session.json')
env=os.environ.copy()
if session.exists() and not args.no_session: env['FOLLOWTHROUGH_SESSION']=base64.b64encode(session.read_bytes()).decode()
if args.platform=='mac':
    app=root/'DerivedData/Build/Products/Debug/Followthrough Local.app'
    identity='-' if args.ad_hoc else args.sign_identity
    for extension in (app/'Contents/PlugIns').glob('*.appex'): subprocess.run(['codesign','--force','--sign',identity,'--entitlements',str(root/'Config/Extension.entitlements'),str(extension)],check=True)
    subprocess.run(['codesign','--force','--sign',identity,'--entitlements',str(root/'Config/App.entitlements'),str(app)],check=True)
    log=(root/'mac-runtime.log').open('w')
    process=subprocess.Popen([str(app/'Contents/MacOS/Followthrough Local')],env=env,stdout=log,stderr=log,start_new_session=True)
    print('Mac process:',process.pid)
else:
    if not args.simulator: p.error('--simulator required for iOS')
    app=root/'DerivedData/Build/Products/Debug-iphonesimulator/Followthrough Local.app'
    subprocess.run(['xcrun','simctl','install',args.simulator,str(app)],check=True)
    subprocess.run(['xcrun','simctl','terminate',args.simulator,'dev.ethosapps.followthrough.local'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if 'FOLLOWTHROUGH_SESSION' in env: env['SIMCTL_CHILD_FOLLOWTHROUGH_SESSION']=env.pop('FOLLOWTHROUGH_SESSION')
    subprocess.run(['xcrun','simctl','launch',args.simulator,'dev.ethosapps.followthrough.local'],env=env,check=True)
