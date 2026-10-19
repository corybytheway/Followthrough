# Created by Cory McCabe
"""Build the secret-free Shortcut. Sign the output with Apple's shortcuts CLI."""
from pathlib import Path
import argparse
import plistlib
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://followthrough.site/api/shortcuts/capture'


def uid(name):
    return str(uuid5(NAMESPACE_URL, 'followthrough/v6/' + name)).upper()


def output(name):
    return {'OutputUUID': uid(name), 'Type': 'ActionOutput', 'OutputName': name}


def variable(name):
    return {'Value': output(name), 'WFSerializationType': 'WFTextTokenAttachment'}


def text(*parts):
    value, attachments = '', {}
    for part in parts:
        if isinstance(part, dict):
            attachments['{%d, 1}' % (len(value.encode('utf-16-le')) // 2)] = part
            value += '\ufffc'
        else:
            value += part
    return {'Value': {'string': value, 'attachmentsByRange': attachments},
            'WFSerializationType': 'WFTextTokenString'}


def dictionary(items):
    return {'Value': {'WFDictionaryFieldValueItems': [
        {'WFItemType': 0, 'WFKey': text(key), 'WFValue': text(*value)}
        for key, value in items]}, 'WFSerializationType': 'WFDictionaryFieldValue'}


actions = []


def add(identifier, name=None, **parameters):
    if name:
        parameters.update(UUID=uid(name), CustomOutputName=name)
    actions.append({'WFWorkflowActionIdentifier': 'is.workflow.actions.' + identifier,
                    'WFWorkflowActionParameters': parameters})


# This direct flow was verified on the physical iPhone. An empty Text result is
# still a content item in Shortcuts, so the earlier file/If setup could silently
# skip pairing. Keep the connection in one explicitly editable Text action.
add('gettext', 'Private connection', WFTextActionText='{}')
add('getvalueforkey', 'Site connection', WFDictionaryKey='site', WFInput=variable('Private connection'))
add('getvalueforkey', 'Capture connection', WFDictionaryKey='capture', WFInput=variable('Private connection'))
add('comment', WFCommentActionText=(
    'Created by Cory McCabe. One-time setup: copy your connection code from '
    'Followthrough Settings, edit this shortcut, and replace {} in the first Text action '
    'with the complete code. Keep the configured shortcut private. '
    'Talk or Type saves directly to Followthrough and shows the server confirmation. '
    'No browser is opened. Requires internet.'))
headers = dictionary([
    ('OAI-Sites-Authorization', ['Bearer ', output('Site connection')]),
    ('X-Followthrough-Capture-Key', [output('Capture connection')]),
])
add('choosefrommenu', WFMenuPrompt='New Followthrough task', WFControlFlowMode=0,
    WFMenuItems=['Talk', 'Type'], GroupingIdentifier=uid('Talk or Type'))
add('choosefrommenu', WFControlFlowMode=1, WFMenuItemTitle='Talk', GroupingIdentifier=uid('Talk or Type'))
add('dictatetext', 'Dictated task', WFDictateTextStopListening='On Tap')
add('choosefrommenu', WFControlFlowMode=1, WFMenuItemTitle='Type', GroupingIdentifier=uid('Talk or Type'))
add('ask', 'Typed task', WFInputType='Text', WFAskActionPrompt='What needs doing?', WFAskActionAllowsMultilineText=True)
add('choosefrommenu', 'Task text', WFControlFlowMode=2, GroupingIdentifier=uid('Talk or Type'))
add('downloadurl', 'Capture request', WFURL=text(BASE), WFHTTPMethod='GET', WFHTTPHeaders=headers)
add('getvalueforkey', 'Request ID', WFDictionaryKey='requestId', WFInput=variable('Capture request'))
add('downloadurl', 'Save response', WFURL=text(BASE), WFHTTPMethod='POST', WFHTTPHeaders=headers,
    WFHTTPBodyType='JSON', WFJSONValues=dictionary([
        ('source', [output('Task text')]), ('requestId', [output('Request ID')])]))
add('getvalueforkey', 'Save confirmation', WFDictionaryKey='message', WFInput=variable('Save response'))
add('showresult', Text=text(output('Save confirmation')))

workflow = {
    'WFWorkflowName': 'Followthrough Task',
    'WFWorkflowActions': actions,
    'WFWorkflowImportQuestions': [],
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowClientVersion': '5037.0.17',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': -43634177, 'WFWorkflowIconGlyphNumber': 61440},
    'WFWorkflowTypes': ['Watch', 'WFWorkflowTypeShowInSearch'],
    'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
    'WFWorkflowOutputContentItemClasses': [],
    'WFWorkflowHasShortcutInputVariables': False,
    'WFWorkflowHasOutputFallback': False,
    'WFQuickActionSurfaces': [],
}
destination = ROOT / 'shortcuts/Followthrough Task.plist'
destination.write_bytes(plistlib.dumps(workflow))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--unsigned-output', type=Path,
                    help='Also write a binary .shortcut file for the Apple signing command')
args = parser.parse_args()
if args.unsigned_output:
    args.unsigned_output.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(f'Created {len(actions)} actions. No import questions or browser-opening actions.')
