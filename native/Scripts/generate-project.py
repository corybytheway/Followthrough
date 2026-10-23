#!/usr/bin/env python3
# Created by Cory McCabe
"""Generate a dependency-free Xcode project for local iOS and macOS development."""
from pathlib import Path
import hashlib, json, plistlib
root=Path(__file__).resolve().parents[1]
objects={}
def ident(value): return hashlib.sha256(value.encode()).hexdigest()[:24].upper()
def add(key,isa,**fields):
    i=ident(key); objects[i]={'isa':isa,**fields}; return i
def quote(v):
    if isinstance(v,dict): return '{ '+ ' '.join(quote(k)+' = '+quote(val)+';' for k,val in v.items())+' }'
    if isinstance(v,list): return '( '+', '.join(quote(x) for x in v)+' )'
    return json.dumps(str(v))
def plist(name,values):
    path=root/'Config'/name; path.write_bytes(plistlib.dumps(values)); return 'Config/'+name
base={'CFBundleDisplayName':'Followthrough','CFBundleDevelopmentRegion':'en','CFBundleExecutable':'$(EXECUTABLE_NAME)','CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleInfoDictionaryVersion':'6.0','CFBundleName':'$(PRODUCT_NAME)','CFBundleShortVersionString':'$(MARKETING_VERSION)','CFBundleVersion':'$(CURRENT_PROJECT_VERSION)','FollowthroughAppGroup':'$(FOLLOWTHROUGH_APP_GROUP)'}
appinfo={**base,'CFBundlePackageType':'APPL','CFBundleDisplayName':'$(FOLLOWTHROUGH_DISPLAY_NAME)','CFBundleURLTypes':[{'CFBundleURLName':'Followthrough','CFBundleURLSchemes':['followthrough']}], 'NSCalendarsFullAccessUsageDescription':'Check which calendars are available on this device. No events are changed by this check.', 'NSCalendarsUsageDescription':'Check access to your device calendars.', 'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},'LSApplicationCategoryType':'public.app-category.productivity','ITSAppUsesNonExemptEncryption':False,'UISupportedInterfaceOrientations~ipad':['UIInterfaceOrientationPortrait','UIInterfaceOrientationPortraitUpsideDown','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight'],'UILaunchScreen':{},'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False},'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight']}
plist('App.plist',appinfo)
plist('Widget.plist',{**base,'CFBundlePackageType':'XPC!','NSExtension':{'NSExtensionPointIdentifier':'com.apple.widgetkit-extension'}})
plist('Share.plist',{**base,'CFBundlePackageType':'XPC!','NSExtension':{'NSExtensionPointIdentifier':'com.apple.share-services','NSExtensionPrincipalClass':'$(PRODUCT_MODULE_NAME).ShareViewController','NSExtensionAttributes':{'NSExtensionActivationRule':{'NSExtensionActivationSupportsText':True,'NSExtensionActivationSupportsWebURLWithMaxCount':1}}}})
plist('Watch.plist',{**{key:value for key,value in base.items() if key!='FollowthroughAppGroup'},'FollowthroughWatchAppGroup':'$(FOLLOWTHROUGH_APP_GROUP)','CFBundlePackageType':'APPL','WKApplication':True,'WKCompanionAppBundleIdentifier':'$(FOLLOWTHROUGH_COMPANION_BUNDLE_IDENTIFIER)','WKRunsIndependentlyOfCompanionApp':False,'CFBundleURLTypes':[{'CFBundleURLName':'Followthrough Watch','CFBundleURLSchemes':['followthrough']}]})
plist('WatchWidget.plist',{**{key:value for key,value in base.items() if key!='FollowthroughAppGroup'},'FollowthroughWatchAppGroup':'$(FOLLOWTHROUGH_APP_GROUP)','CFBundlePackageType':'XPC!','NSExtension':{'NSExtensionPointIdentifier':'com.apple.widgetkit-extension'}})
plist('Watch.entitlements',{'com.apple.security.application-groups':['$(FOLLOWTHROUGH_APP_GROUP)']})
plist('App.entitlements',{'com.apple.security.app-sandbox':True,'com.apple.security.network.client':True,'com.apple.security.personal-information.calendars':True,'com.apple.security.application-groups':['6G252Y8692.dev.ethosapps.followthrough.local']})
plist('Extension.entitlements',{'com.apple.security.app-sandbox':True,'com.apple.security.application-groups':['6G252Y8692.dev.ethosapps.followthrough.local']})
plist('AppMacRelease.entitlements',{'com.apple.security.app-sandbox':True,'com.apple.security.network.client':True,'com.apple.security.personal-information.calendars':True,'com.apple.security.application-groups':['$(FOLLOWTHROUGH_APP_GROUP)']})
plist('ExtensionMacRelease.entitlements',{'com.apple.security.app-sandbox':True,'com.apple.security.application-groups':['$(FOLLOWTHROUGH_APP_GROUP)']})
plist('AppIOS.entitlements',{'application-identifier':'LOCALONLY.dev.ethosapps.followthrough.local','keychain-access-groups':['LOCALONLY.dev.ethosapps.followthrough.local'],'com.apple.security.application-groups':['group.dev.ethosapps.followthrough.local']})
plist('ExtensionIOS.entitlements',{'com.apple.security.application-groups':['group.dev.ethosapps.followthrough.local']})
plist('AppIOSDevice.entitlements',{'com.apple.security.application-groups':['$(FOLLOWTHROUGH_APP_GROUP)']})
plist('ExtensionIOSDevice.entitlements',{'com.apple.security.application-groups':['$(FOLLOWTHROUGH_APP_GROUP)']})
allfiles=sorted(set([str(p.relative_to(root)) for p in root.glob('*/*.swift')]+['Tests/FollowthroughUITests.swift']))
refs={f:add('file'+f,'PBXFileReference',lastKnownFileType='sourcecode.swift',path=f,sourceTree='<group>') for f in allfiles}
refs['Assets.xcassets']=add('assets','PBXFileReference',lastKnownFileType='folder.assetcatalog',path='Assets.xcassets',sourceTree='<group>')
refs['WatchAssets.xcassets']=add('watchassets','PBXFileReference',lastKnownFileType='folder.assetcatalog',path='WatchAssets.xcassets',sourceTree='<group>')
refs['Config/PrivacyInfo.xcprivacy']=add('privacy','PBXFileReference',lastKnownFileType='text.xml',path='Config/PrivacyInfo.xcprivacy',sourceTree='<group>')
productrefs=[]; targets=[]
project_id=ident('project')
common={'SWIFT_VERSION':'5.0','CLANG_ENABLE_MODULES':'YES','ENABLE_USER_SCRIPT_SANDBOXING':'YES','SWIFT_STRICT_CONCURRENCY':'targeted','CODE_SIGN_IDENTITY':'-','CODE_SIGN_STYLE':'Manual','DEVELOPMENT_TEAM':'','MACOSX_DEPLOYMENT_TARGET':'15.0','IPHONEOS_DEPLOYMENT_TARGET':'18.0','GENERATE_INFOPLIST_FILE':'NO','CURRENT_PROJECT_VERSION':'3','MARKETING_VERSION':'1.0','ENABLE_HARDENED_RUNTIME':'YES','SWIFT_EMIT_LOC_STRINGS':'YES'}
def configs(key,settings,release=None):
    ids=[]
    for name in ['Debug','Release']:
        config={**settings,'SWIFT_OPTIMIZATION_LEVEL':'-Onone' if name=='Debug' else '-O','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if name=='Debug' else '', 'DEBUG_INFORMATION_FORMAT':'dwarf' if name=='Debug' else 'dwarf-with-dsym'}
        if name == 'Release': config.update(release or {})
        ids.append(add(key+name,'XCBuildConfiguration',name=name,buildSettings=config))
    return add(key+'list','XCConfigurationList',buildConfigurations=ids,defaultConfigurationIsVisible=0,defaultConfigurationName='Debug')
def target(name,platform,kind,files,extensions=[],watch=None):
    ext=kind!='app'; bundle='dev.ethosapps.followthrough.local'+('.'+kind if ext else '')
    product=add(name+'product','PBXFileReference',explicitFileType='wrapper.app-extension' if ext else 'wrapper.application',path=('Followthrough Local' if not ext else name)+('.appex' if ext else '.app'),sourceTree='BUILT_PRODUCTS_DIR')
    productrefs.append(product)
    builds=[add(name+f,'PBXBuildFile',fileRef=refs[f]) for f in files]
    resources=[] if ext else [add(name+'assets','PBXBuildFile',fileRef=refs['Assets.xcassets']),add(name+'privacy','PBXBuildFile',fileRef=refs['Config/PrivacyInfo.xcprivacy'])]
    phases=[add(name+'sources','PBXSourcesBuildPhase',buildActionMask=2147483647,files=builds,runOnlyForDeploymentPostprocessing=0),add(name+'frameworks','PBXFrameworksBuildPhase',buildActionMask=2147483647,files=[],runOnlyForDeploymentPostprocessing=0),add(name+'resources','PBXResourcesBuildPhase',buildActionMask=2147483647,files=resources,runOnlyForDeploymentPostprocessing=0)]
    deps=[]
    if extensions:
        embeds=[]
        for ename in extensions:
            embeds.append(add(name+'embed'+ename,'PBXBuildFile',fileRef=ident(ename+'product'),settings={'ATTRIBUTES':['RemoveHeadersOnCopy']}))
            proxy=add(name+'proxy'+ename,'PBXContainerItemProxy',containerPortal=project_id,proxyType=1,remoteGlobalIDString=ident(ename),remoteInfo=ename)
            deps.append(add(name+'dep'+ename,'PBXTargetDependency',target=ident(ename),targetProxy=proxy))
        phases.append(add(name+'embed','PBXCopyFilesBuildPhase',buildActionMask=2147483647,dstPath='',dstSubfolderSpec=13,files=embeds,name='Embed Extensions',runOnlyForDeploymentPostprocessing=0))
    if watch:
        build=add(name+'embed'+watch,'PBXBuildFile',fileRef=ident(watch+'product'),settings={'ATTRIBUTES':['RemoveHeadersOnCopy']})
        proxy=add(name+'proxy'+watch,'PBXContainerItemProxy',containerPortal=project_id,proxyType=1,remoteGlobalIDString=ident(watch),remoteInfo=watch)
        deps.append(add(name+'dep'+watch,'PBXTargetDependency',target=ident(watch),targetProxy=proxy))
        phases.append(add(name+'embedwatch','PBXCopyFilesBuildPhase',buildActionMask=2147483647,dstPath='$(CONTENTS_FOLDER_PATH)/Watch',dstSubfolderSpec=16,files=[build],name='Embed Watch Content',runOnlyForDeploymentPostprocessing=0))
    settings={**common,'PRODUCT_NAME':'Followthrough Local' if not ext else name,'PRODUCT_MODULE_NAME':name.replace('-','_'),'PRODUCT_BUNDLE_IDENTIFIER':bundle,'SDKROOT':'macosx' if platform=='mac' else 'iphoneos','SUPPORTED_PLATFORMS':'macosx' if platform=='mac' else 'iphoneos iphonesimulator','TARGETED_DEVICE_FAMILY':'1,2','INFOPLIST_FILE':'Config/'+('App.plist' if not ext else 'Widget.plist' if kind=='widgets' else 'Share.plist'),'CODE_SIGN_ENTITLEMENTS':'Config/'+(('App.entitlements' if not ext else 'Extension.entitlements') if platform=='mac' else ('AppIOS.entitlements' if not ext else 'ExtensionIOS.entitlements')),'LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/../Frameworks' if platform=='mac' else '@executable_path/Frameworks'], 'SKIP_INSTALL':'YES' if ext else 'NO','APPLICATION_EXTENSION_API_ONLY':'YES' if ext else 'NO'}
    settings['FOLLOWTHROUGH_DISPLAY_NAME']='Followthrough Local'
    settings['FOLLOWTHROUGH_APP_GROUP']='6G252Y8692.dev.ethosapps.followthrough.local' if platform=='mac' else 'group.dev.ethosapps.followthrough.local'
    if platform=='mac': settings.update({'DEVELOPMENT_TEAM':'6G252Y8692','CODE_SIGN_IDENTITY':'Apple Development'})
    else:
        # Keep local simulator identities and entitlements unchanged. Xcode supplies
        # the provisioning-profile application and keychain identifiers on devices.
        settings.update({
            'PRODUCT_BUNDLE_IDENTIFIER[sdk=iphoneos*]':'com.ethos.followthrough'+('.'+kind if ext else ''),
            'CODE_SIGN_STYLE[sdk=iphoneos*]':'Automatic',
            'CODE_SIGN_IDENTITY[sdk=iphoneos*]':'Apple Development',
            'DEVELOPMENT_TEAM[sdk=iphoneos*]':'6G252Y8692',
            'CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*]':'Config/'+('ExtensionIOSDevice.entitlements' if ext else 'AppIOSDevice.entitlements'),
            'FOLLOWTHROUGH_APP_GROUP[sdk=iphoneos*]':'group.com.ethos.followthrough',
            'FOLLOWTHROUGH_DISPLAY_NAME[sdk=iphoneos*]':'Followthrough',
        })
    if not ext: settings['ASSETCATALOG_COMPILER_APPICON_NAME']='AppIcon'
    if ext: settings['LD_RUNPATH_SEARCH_PATHS']+=['@executable_path/../../Frameworks']
    release={}
    if platform=='mac':
        # Keep Debug's local identity and connected workspace; Release matches ASC.
        release={'PRODUCT_BUNDLE_IDENTIFIER':'com.ethos.followthrough'+('.'+kind if ext else ''),'CODE_SIGN_STYLE':'Automatic','FOLLOWTHROUGH_APP_GROUP':'group.com.ethos.followthrough','FOLLOWTHROUGH_DISPLAY_NAME':'Followthrough','CODE_SIGN_ENTITLEMENTS':'Config/'+('ExtensionMacRelease.entitlements' if ext else 'AppMacRelease.entitlements')}
    if not ext: release['PRODUCT_NAME']='Followthrough'
    t=add(name,'PBXNativeTarget',name=name,productName=name,productReference=product,productType='com.apple.product-type.app-extension' if ext else 'com.apple.product-type.application',buildConfigurationList=configs(name,settings,release),buildPhases=phases,buildRules=[],dependencies=deps)
    targets.append(t)
    return t
model=['Shared/Models.swift','Shared/BrandColors.swift']
widget=model+['Widgets/FollowthroughWidget.swift']
target('FollowthroughWidgetsMac','mac','widgets',widget)
target('FollowthroughWidgetsIOS','ios','widgets',widget)
target('FollowthroughShare','ios','share',model+['Share/ShareViewController.swift'])
app=[f for f in allfiles if f.startswith('App/') or f.startswith('Shared/')]
watchname='FollowthroughWatch'
watchproduct=add(watchname+'product','PBXFileReference',explicitFileType='wrapper.application',path='Followthrough Watch.app',sourceTree='BUILT_PRODUCTS_DIR')
productrefs.append(watchproduct)
watchfiles=[f for f in allfiles if f.startswith('Watch/')]+['Shared/CaptureIntent.swift','Shared/WatchCapture.swift','Shared/WatchPlan.swift','Shared/WatchCaptureComplicationView.swift']
watchbuilds=[add(watchname+f,'PBXBuildFile',fileRef=refs[f]) for f in watchfiles]
watchsettings={**common,'PRODUCT_NAME':'Followthrough Watch','PRODUCT_MODULE_NAME':watchname,'PRODUCT_BUNDLE_IDENTIFIER':'dev.ethosapps.followthrough.local.watchkitapp','SDKROOT':'watchos','SUPPORTED_PLATFORMS':'watchos watchsimulator','WATCHOS_DEPLOYMENT_TARGET':'11.0','TARGETED_DEVICE_FAMILY':'4','INFOPLIST_FILE':'Config/Watch.plist','FOLLOWTHROUGH_COMPANION_BUNDLE_IDENTIFIER':'dev.ethosapps.followthrough.local','CODE_SIGN_STYLE':'Automatic','CODE_SIGN_IDENTITY':'Apple Development','DEVELOPMENT_TEAM':'6G252Y8692','SKIP_INSTALL':'YES','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks'],'PRODUCT_BUNDLE_IDENTIFIER[sdk=watchos*]':'com.ethos.followthrough.watchkitapp','FOLLOWTHROUGH_COMPANION_BUNDLE_IDENTIFIER[sdk=watchos*]':'com.ethos.followthrough'}
watchrelease={'PRODUCT_BUNDLE_IDENTIFIER':'com.ethos.followthrough.watchkitapp','FOLLOWTHROUGH_COMPANION_BUNDLE_IDENTIFIER':'com.ethos.followthrough'}
watchsettings.update({'CODE_SIGN_ENTITLEMENTS':'Config/Watch.entitlements','FOLLOWTHROUGH_APP_GROUP':'group.dev.ethosapps.followthrough.local.watch','FOLLOWTHROUGH_APP_GROUP[sdk=watchos*]':'group.com.ethos.followthrough'})
watchrelease['FOLLOWTHROUGH_APP_GROUP']='group.com.ethos.followthrough'
watchwidget='FollowthroughWatchWidgets'
watchwidgetproduct=add(watchwidget+'product','PBXFileReference',explicitFileType='wrapper.app-extension',path=watchwidget+'.appex',sourceTree='BUILT_PRODUCTS_DIR')
productrefs.append(watchwidgetproduct)
watchwidgetfiles=['WatchWidgets/FollowthroughWatchWidgets.swift','Shared/WatchPlan.swift','Shared/WatchCapture.swift','Shared/WatchCaptureComplicationView.swift']
watchwidgetsettings={**watchsettings,'PRODUCT_NAME':watchwidget,'PRODUCT_MODULE_NAME':watchwidget,'PRODUCT_BUNDLE_IDENTIFIER':'dev.ethosapps.followthrough.local.watchkitapp.widgets','PRODUCT_BUNDLE_IDENTIFIER[sdk=watchos*]':'com.ethos.followthrough.watchkitapp.widgets','INFOPLIST_FILE':'Config/WatchWidget.plist','APPLICATION_EXTENSION_API_ONLY':'YES'}
watchwidgetsettings.pop('ASSETCATALOG_COMPILER_APPICON_NAME',None)
watchwidgetphases=[add(watchwidget+'sources','PBXSourcesBuildPhase',buildActionMask=2147483647,files=[add(watchwidget+f,'PBXBuildFile',fileRef=refs[f]) for f in watchwidgetfiles],runOnlyForDeploymentPostprocessing=0),add(watchwidget+'frameworks','PBXFrameworksBuildPhase',buildActionMask=2147483647,files=[],runOnlyForDeploymentPostprocessing=0),add(watchwidget+'resources','PBXResourcesBuildPhase',buildActionMask=2147483647,files=[],runOnlyForDeploymentPostprocessing=0)]
targets.append(add(watchwidget,'PBXNativeTarget',name=watchwidget,productName=watchwidget,productReference=watchwidgetproduct,productType='com.apple.product-type.app-extension',buildConfigurationList=configs(watchwidget,watchwidgetsettings,{'PRODUCT_BUNDLE_IDENTIFIER':'com.ethos.followthrough.watchkitapp.widgets','FOLLOWTHROUGH_APP_GROUP':'group.com.ethos.followthrough'}),buildPhases=watchwidgetphases,buildRules=[],dependencies=[]))
watchphases=[add(watchname+'sources','PBXSourcesBuildPhase',buildActionMask=2147483647,files=watchbuilds,runOnlyForDeploymentPostprocessing=0),add(watchname+'frameworks','PBXFrameworksBuildPhase',buildActionMask=2147483647,files=[],runOnlyForDeploymentPostprocessing=0),add(watchname+'resources','PBXResourcesBuildPhase',buildActionMask=2147483647,files=[add(watchname+'assets','PBXBuildFile',fileRef=refs['WatchAssets.xcassets'])],runOnlyForDeploymentPostprocessing=0)]
watchwidgetproxy=add(watchname+'proxy'+watchwidget,'PBXContainerItemProxy',containerPortal=project_id,proxyType=1,remoteGlobalIDString=ident(watchwidget),remoteInfo=watchwidget)
watchwidgetdep=add(watchname+'dep'+watchwidget,'PBXTargetDependency',target=ident(watchwidget),targetProxy=watchwidgetproxy)
watchphases.append(add(watchname+'embedwidgets','PBXCopyFilesBuildPhase',buildActionMask=2147483647,dstPath='',dstSubfolderSpec=13,files=[add(watchname+'embed'+watchwidget,'PBXBuildFile',fileRef=watchwidgetproduct,settings={'ATTRIBUTES':['RemoveHeadersOnCopy']})],name='Embed Watch Complications',runOnlyForDeploymentPostprocessing=0))
targets.append(add(watchname,'PBXNativeTarget',name=watchname,productName=watchname,productReference=watchproduct,productType='com.apple.product-type.application',buildConfigurationList=configs(watchname,watchsettings,watchrelease),buildPhases=watchphases,buildRules=[],dependencies=[watchwidgetdep]))
target('FollowthroughMac','mac','app',app,['FollowthroughWidgetsMac'])
target('FollowthroughIOS','ios','app',app,['FollowthroughWidgetsIOS','FollowthroughShare'],watch=watchname)
for testname, tested, sdk in [('FollowthroughUITests','FollowthroughIOS','iphoneos'),('FollowthroughMacUITests','FollowthroughMac','macosx')]:
    testproduct=add(testname+'product','PBXFileReference',explicitFileType='wrapper.cfbundle',path=testname+'.xctest',sourceTree='BUILT_PRODUCTS_DIR')
    productrefs.append(testproduct)
    testbuild=add(testname+'sourcefile','PBXBuildFile',fileRef=refs['Tests/'+testname+'.swift'])
    testphase=add(testname+'sources','PBXSourcesBuildPhase',buildActionMask=2147483647,files=[testbuild],runOnlyForDeploymentPostprocessing=0)
    testproxy=add(testname+'proxy','PBXContainerItemProxy',containerPortal=project_id,proxyType=1,remoteGlobalIDString=ident(tested),remoteInfo=tested)
    testdep=add(testname+'dependency','PBXTargetDependency',target=ident(tested),targetProxy=testproxy)
    testsettings={**common,'PRODUCT_NAME':testname,'PRODUCT_BUNDLE_IDENTIFIER':'dev.ethosapps.followthrough.local.'+testname.lower(),'GENERATE_INFOPLIST_FILE':'YES','SDKROOT':sdk,'SUPPORTED_PLATFORMS':'macosx' if sdk=='macosx' else 'iphonesimulator iphoneos','TEST_TARGET_NAME':tested,'TARGETED_DEVICE_FAMILY':'1,2','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks','@loader_path/Frameworks']}
    if sdk=='macosx': testsettings.update({'DEVELOPMENT_TEAM':'6G252Y8692','CODE_SIGN_IDENTITY':'Apple Development'})
    targets.append(add(testname,'PBXNativeTarget',name=testname,productName=testname,productReference=testproduct,productType='com.apple.product-type.bundle.ui-testing',buildConfigurationList=configs(testname,testsettings),buildPhases=[testphase],buildRules=[],dependencies=[testdep]))
products=add('products' ,'PBXGroup',name='Products',children=productrefs,sourceTree='<group>')
main=add('main','PBXGroup',children=list(refs.values())+[products],sourceTree='<group>')
objects[project_id]={'isa':'PBXProject','attributes':{'LastUpgradeCheck':'2700'},'buildConfigurationList':configs('project',{}),'compatibilityVersion':'Xcode 14.0','developmentRegion':'en','hasScannedForEncodings':0,'knownRegions':['en','Base'],'mainGroup':main,'productRefGroup':products,'projectDirPath':'','projectRoot':'','targets':targets}
p=root/'Followthrough.xcodeproj';p.mkdir(exist_ok=True)
(p/'project.pbxproj').write_text('// !$*UTF8*$!\n'+quote({'archiveVersion':'1','classes':{},'objectVersion':'56','objects':objects,'rootObject':project_id})+'\n')
schemes=p/'xcshareddata/xcschemes';schemes.mkdir(parents=True,exist_ok=True)
for name in ['FollowthroughMac','FollowthroughIOS']:
    ref=f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ident(name)}" BuildableName="Followthrough Local.app" BlueprintName="{name}" ReferencedContainer="container:Followthrough.xcodeproj"/>'
    testname='FollowthroughUITests' if name=='FollowthroughIOS' else 'FollowthroughMacUITests'
    testaction = f'<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ident(testname)}" BuildableName="{testname}.xctest" BlueprintName="{testname}" ReferencedContainer="container:Followthrough.xcodeproj"/></TestableReference></Testables></TestAction>'
    (schemes/(name+'.xcscheme')).write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref}</BuildActionEntry></BuildActionEntries></BuildAction>{testaction}<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref}</BuildableProductRunnable></LaunchAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
print('Generated',p)

watchref=f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ident(watchname)}" BuildableName="Followthrough Watch.app" BlueprintName="{watchname}" ReferencedContainer="container:Followthrough.xcodeproj"/>'
(schemes/(watchname+'.xcscheme')).write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{watchref}</BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{watchref}</BuildableProductRunnable></LaunchAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
