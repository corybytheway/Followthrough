# Created by Cory McCabe
"""Build the Talk/Type shortcut that uses Followthrough's native app action.

Sign the binary output with Apple's shortcuts CLI before distributing it.
"""
import argparse
from pathlib import Path
import plistlib
from uuid import NAMESPACE_URL, uuid5


ROOT = Path(__file__).resolve().parents[1]


def uid(name):
    return str(uuid5(NAMESPACE_URL, 'followthrough/native-talk-or-type/v1/' + name)).upper()


def output(name):
    return {'OutputUUID': uid(name), 'Type': 'ActionOutput', 'OutputName': name}


def text(value):
    return {
        'Value': {'string': '\ufffc', 'attachmentsByRange': {'{0, 1}': output(value)}},
        'WFSerializationType': 'WFTextTokenString',
    }


actions = []


def add(identifier, name=None, **parameters):
    if name:
        parameters.update(UUID=uid(name), CustomOutputName=name)
    actions.append({
        'WFWorkflowActionIdentifier': identifier,
        'WFWorkflowActionParameters': parameters,
    })


add('is.workflow.actions.comment', WFCommentActionText=(
    'Created by Cory McCabe. Choose Talk or Type to add a task to Followthrough.'))
add('is.workflow.actions.choosefrommenu', WFMenuPrompt='New Followthrough task',
    WFControlFlowMode=0, WFMenuItems=['Talk', 'Type'], GroupingIdentifier=uid('Talk or Type'))
add('is.workflow.actions.choosefrommenu', WFControlFlowMode=1,
    WFMenuItemTitle='Talk', GroupingIdentifier=uid('Talk or Type'))
add('is.workflow.actions.dictatetext', 'Dictated task', WFDictateTextStopListening='On Tap')
add('is.workflow.actions.choosefrommenu', WFControlFlowMode=1,
    WFMenuItemTitle='Type', GroupingIdentifier=uid('Talk or Type'))
add('is.workflow.actions.ask', 'Typed task', WFInputType='Text',
    WFAskActionPrompt='What needs doing?', WFAskActionAllowsMultilineText=True)
add('is.workflow.actions.choosefrommenu', 'Task text', WFControlFlowMode=2,
    GroupingIdentifier=uid('Talk or Type'))
# Descriptor exported by Shortcuts from the shipping app's Capture a task action.
add('com.ethos.followthrough.CaptureTaskIntent', 'Capture task',
    AppIntentDescriptor={
        'AppIntentIdentifier': 'CaptureTaskIntent',
        'BundleIdentifier': 'com.ethos.followthrough',
        'Name': 'Followthrough',
        'TeamIdentifier': '6G252Y8692',
    }, request=text('Task text'))

workflow = {
    'WFWorkflowName': 'Followthrough Talk or Type',
    'WFWorkflowActions': actions,
    'WFWorkflowImportQuestions': [],
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowClientVersion': '5114.0.8.3',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': -1448498689, 'WFWorkflowIconGlyphNumber': 61440},
    'WFWorkflowTypes': ['Watch', 'WFWorkflowTypeShowInSearch'],
    'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
    'WFWorkflowOutputContentItemClasses': [],
    'WFWorkflowHasShortcutInputVariables': False,
    'WFWorkflowHasOutputFallback': False,
    'WFQuickActionSurfaces': [],
}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--unsigned-output', type=Path,
                    help='Also write a binary .shortcut file for the Apple signing command')
args = parser.parse_args()
(ROOT / 'shortcuts/Followthrough Talk or Type.plist').write_bytes(plistlib.dumps(workflow))
if args.unsigned_output:
    args.unsigned_output.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(f'Created {len(actions)} actions. Native account; Talk/Type; no credentials or web requests.')
