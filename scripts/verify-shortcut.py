# Created by Cory McCabe
"""Check the generated Shortcut's import, references, and capture boundaries.

These are artifact checks, not a substitute for an actual iPhone import/run.
"""
from pathlib import Path
import plistlib
import re

source = Path(__file__).resolve().parents[1] / 'shortcuts/Followthrough Task.plist'
workflow = plistlib.loads(source.read_bytes())
actions = workflow['WFWorkflowActions']
assert workflow['WFWorkflowImportQuestions'] == [], 'Import must not ask for a connection code'
assert not re.search(r'ft_[a-f0-9]{64}', source.read_text()), 'Never distribute capture credentials'

seen, groups = set(), []
by_name = {}


def references(value):
    if isinstance(value, dict):
        if value.get('Type') == 'ActionOutput':
            assert value['OutputUUID'] in seen, f'Unresolved variable: {value}'
        for child in value.values():
            references(child)
    elif isinstance(value, list):
        for child in value:
            references(child)


for index, action in enumerate(actions):
    identifier = action['WFWorkflowActionIdentifier']
    assert identifier not in {'is.workflow.actions.openurl', 'is.workflow.actions.openin',
                              'is.workflow.actions.runjavascriptonwebpage'}
    p = action['WFWorkflowActionParameters']
    references(p)
    if 'UUID' in p:
        assert p['UUID'] not in seen, 'Duplicate action identity'
        seen.add(p['UUID'])
    if 'CustomOutputName' in p:
        by_name[p['CustomOutputName']] = (index, p)
    if 'WFControlFlowMode' in p:
        mode = p['WFControlFlowMode']
        if mode == 0:
            groups.append(p['GroupingIdentifier'])
        else:
            assert groups and groups[-1] == p['GroupingIdentifier'], 'Unbalanced control flow'
            if mode == 2:
                groups.pop()
assert not groups

load = by_name['Saved connection file'][1]
save = by_name['Remembered connection file'][1]
assert load['WFFileErrorIfNotFound'] is False
assert load['WFGetFilePath'] == save['WFFileDestinationPath'] == '/Followthrough-connection.json'
assert save['WFAskWhereToSave'] is False and save['WFSaveFileOverwrite'] is True
assert by_name['Request ID'][0] < by_name['Connection failed'][0] < by_name['Remembered connection file'][0]
assert by_name['Remembered connection file'][0] < by_name['Task text'][0]
assert by_name['Connecting only'][0] < by_name['Task text'][0]
assert by_name['Save response'][1]['WFHTTPBodyType'] == 'JSON'
assert by_name['Save response'][1]['WFHTTPMethod'] == 'POST'
assert by_name['Capture request'][1]['WFHTTPMethod'] == 'GET'
for name in ['Capture request', 'Save response']:
    assert by_name[name][1]['WFInput'] == 'https://followthrough.corybytheway.chatgpt.site/api/shortcuts/capture'
print('PASS: no import questions or browser actions; variables and branches resolve; connection is checked before storage; direct save remains intact.')
