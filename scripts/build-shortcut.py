# Created by Cory McCabe
"""Build the secret-free Shortcut. Sign the output with Apple's shortcuts CLI."""
from pathlib import Path
import argparse
import plistlib
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://followthrough.corybytheway.chatgpt.site/api/shortcuts/capture'
CACHE = '/Followthrough-connection.json'


def uid(name):
    return str(uuid5(NAMESPACE_URL, 'followthrough/v4/' + name)).upper()


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


def branch(name, mode, **parameters):
    if mode == 0:
        # If uses WFInputVariable, unlike actions that accept a bare token
        # attachment. A bare attachment imports as an empty Condition chip.
        parameters['WFInput'] = {'Type': 'Variable', 'Variable': parameters['WFInput']}
    add('conditional', name if mode == 2 else None,
        GroupingIdentifier=uid(name), WFControlFlowMode=mode, **parameters)


add('comment', WFCommentActionText=(
    'Created by Cory McCabe. Add this shortcut first, then run it to connect. '
    'On the first run, paste the connection code copied from Followthrough Settings. '
    'The code is checked before it is remembered in iCloud Drive/Shortcuts/Followthrough-connection.json. '
    'Keep that file private. Talk or Type then saves directly and shows the server confirmation. '
    'To reconnect, use Open shortcut to connect in Followthrough Settings. No browser-opening action.'))
add('gettext', 'Launch mode', WFTextActionText=text({'Type': 'ExtensionInput'}))
add('documentpicker.open', 'Saved connection file',
    WFGetFilePath=CACHE, WFFileErrorIfNotFound=False)
add('gettext', 'Saved connection', WFTextActionText=text(output('Saved connection file')))
# A non-secret input sent by the settings page requests reconnection. The Action
# button supplies no input, so normal runs reuse the existing connection.
branch('Connection to use', 0, WFInput=variable('Launch mode'),
    WFCondition=4, WFConditionalActionString='connect')
add('nothing')
branch('Connection to use', 1)
add('gettext', 'Existing connection', WFTextActionText=text(output('Saved connection')))
branch('Connection to use', 2)
branch('Private connection', 0, WFInput=variable('Connection to use'), WFCondition=101)
add('ask', 'Pasted connection', WFInputType='Text',
    WFAskActionPrompt='Connect Followthrough: paste the connection code you copied from Followthrough Settings. This is saved for future runs.',
    WFAskActionAllowsMultilineText=True)
branch('Private connection', 1)
add('gettext', 'Remembered connection', WFTextActionText=text(output('Connection to use')))
branch('Private connection', 2)
add('detect.dictionary', 'Connection details', WFInput=variable('Private connection'))
add('getvalueforkey', 'Site connection', WFDictionaryKey='site', WFInput=variable('Connection details'))
add('getvalueforkey', 'Capture connection', WFDictionaryKey='capture', WFInput=variable('Connection details'))
headers = dictionary([
    ('OAI-Sites-Authorization', ['Bearer ', output('Site connection')]),
    ('X-Followthrough-Capture-Key', [output('Capture connection')]),
])
add('downloadurl', 'Capture request', WFURL=text(BASE), WFHTTPMethod='GET', WFHTTPHeaders=headers)
add('getvalueforkey', 'Request ID', WFDictionaryKey='requestId', WFInput=variable('Capture request'))
branch('Connection failed', 0, WFInput=variable('Request ID'), WFCondition=101)
add('showresult', Text='Could not connect to Followthrough. Copy your current connection code from Settings and use Open shortcut to connect. No task was saved.')
add('exit')
branch('Connection failed', 2)
# Never remember an unverified code. Only the first run and explicit reconnect
# write the file; everyday captures simply read it.
branch('Remember connection', 0, WFInput=variable('Connection to use'), WFCondition=101)
add('documentpicker.save', 'Remembered connection file', WFInput=variable('Private connection'),
    WFAskWhereToSave=False, WFSaveFileOverwrite=True, WFFileDestinationPath=CACHE)
branch('Remember connection', 2)
branch('Connecting only', 0, WFInput=variable('Launch mode'),
    WFCondition=4, WFConditionalActionString='connect')
add('showresult', Text='Followthrough is connected. Your Action button can now save tasks with Talk or Type.')
add('exit')
branch('Connecting only', 2)
add('choosefrommenu', WFMenuPrompt='Followthrough', WFControlFlowMode=0,
    WFMenuItems=['Talk', 'Type'], GroupingIdentifier=uid('Talk or Type'))
add('choosefrommenu', WFControlFlowMode=1, WFMenuItemTitle='Talk', GroupingIdentifier=uid('Talk or Type'))
add('dictatetext', 'Dictated task', WFDictateTextStopListening='On Tap')
add('choosefrommenu', WFControlFlowMode=1, WFMenuItemTitle='Type', GroupingIdentifier=uid('Talk or Type'))
add('ask', 'Typed task', WFInputType='Text', WFAskActionPrompt='What needs doing?', WFAskActionAllowsMultilineText=True)
add('choosefrommenu', 'Task text', WFControlFlowMode=2, GroupingIdentifier=uid('Talk or Type'))
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
    'WFWorkflowHasShortcutInputVariables': True,
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
