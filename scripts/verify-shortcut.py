# Created by Cory McCabe
"""Check the generated Shortcut's import, references, and capture boundaries.

These are artifact checks, not a substitute for an actual iPhone import/run.
"""
from pathlib import Path
import argparse
import plistlib
import re
import subprocess
import tempfile
from shortcut_certificates import verify_signing_chain

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', nargs='?', type=Path,
                    default=Path(__file__).resolve().parents[1] / 'shortcuts/Followthrough Task.plist')
parser.add_argument('--signed-artifact', type=Path,
                    help='Verify the signed download and compare its workflow with the source (macOS)')
args = parser.parse_args()
source = args.source
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
                              'is.workflow.actions.runjavascriptonwebpage',
                              'is.workflow.actions.conditional',
                              'is.workflow.actions.documentpicker.open',
                              'is.workflow.actions.documentpicker.save'}, 'Direct capture must not use browser or file/If setup'
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

assert by_name['Private connection'][0] == 0
assert by_name['Private connection'][1]['WFTextActionText'] == '{}', 'The distributed template must remain unpaired'
assert by_name['Task text'][0] < by_name['Capture request'][0] < by_name['Request ID'][0] < by_name['Save response'][0]
assert by_name['Save response'][1]['WFHTTPBodyType'] == 'JSON'
assert by_name['Save response'][1]['WFHTTPMethod'] == 'POST'
assert by_name['Capture request'][1]['WFHTTPMethod'] == 'GET'
for name in ['Capture request', 'Save response']:
    request = by_name[name][1]
    assert 'WFInput' not in request, 'HTTP actions require WFURL, not WFInput'
    assert request['WFURL']['WFSerializationType'] == 'WFTextTokenString'
    assert request['WFURL']['Value']['string'] == 'https://followthrough.site/api/shortcuts/capture'
print('PASS: secret-free direct capture; no import questions, browser actions, or file/If setup; variables resolve; task input precedes the nonce and authenticated save; both HTTP addresses are populated.')

if args.signed_artifact:
    archive = args.signed_artifact.read_bytes()
    assert archive[:4] == b'AEA1', 'The download must be an Apple-signed Shortcut archive'
    metadata_size = int.from_bytes(archive[8:12], 'little')
    metadata = plistlib.loads(archive[12:12 + metadata_size])
    with tempfile.TemporaryDirectory(prefix='followthrough-shortcut-') as folder:
        folder = Path(folder)
        certificate = verify_signing_chain(metadata['SigningCertificateChain'], folder)
        public_key = folder / 'signing.pem'
        public_key.write_bytes(subprocess.check_output([
            '/usr/bin/openssl', 'x509', '-in', str(certificate), '-pubkey', '-noout']))
        payload = folder / 'workflow.aar'
        subprocess.run(['aea', 'decrypt', '-i', str(args.signed_artifact),
                        '-o', str(payload), '-sign-pub', str(public_key)], check=True)
        extracted = folder / 'extracted'
        extracted.mkdir()
        subprocess.run(['aa', 'extract', '-i', str(payload), '-d', str(extracted),
                        '-include-path', 'Shortcut.wflow'], check=True)
        signed_workflow = plistlib.loads((extracted / 'Shortcut.wflow').read_bytes())
        # Apple's signer updates its client version and removes the workflow
        # name (the download filename supplies it). All other fields must match.
        signing_fields = {'WFWorkflowClientVersion', 'WFWorkflowName'}
        expected = {k: v for k, v in workflow.items() if k not in signing_fields}
        actual = {k: v for k, v in signed_workflow.items() if k not in signing_fields}
        assert actual == expected, 'Signed download differs from the source workflow'
    print('PASS: signing chain trusted to a built-in Apple root and currently valid; archive signature verified; embedded workflow matches the validated source after Apple signing metadata normalization.')
