# Created by Cory McCabe
"""Exercise the direct Shortcut API against local D1 only; remove our test records."""
from pathlib import Path
import subprocess, json, uuid, concurrent.futures, os
base='http://localhost:3000'
cookies=Path('.wrangler/shortcut-test-cookies')
subprocess.run(['curl','-sS','-c',str(cookies),base+'/signin-with-chatgpt?return_to=/','-o','/dev/null'],check=True)
def http(path,body=None,key=None,owner=False,origin=None):
    cmd=['curl','-sS','--max-time','30','-w','\n%{http_code}',base+path]
    if owner: cmd+=['-b',str(cookies)]
    if key: cmd+=['-H','X-Followthrough-Capture-Key: '+key]
    if origin: cmd+=['-H','Origin: '+origin]
    if body is not None: cmd+=['-H','Content-Type: application/json','--data-binary','@-']
    result=subprocess.check_output(cmd,input=json.dumps(body).encode() if body is not None else None).decode()
    data,status=result.rsplit('\n',1)
    try: decoded=json.loads(data)
    except json.JSONDecodeError: decoded={'text': data}
    return int(status),decoded
assert http('/api/shortcuts/connection')[0]==401
assert http('/api/shortcuts/connection',owner=True)[1]['connected'] is False
assert http('/api/shortcuts/capture')[0]==401
created_ids=set()
try:
    status,connected=http('/api/shortcuts/connection',{'action':'connect'},owner=True)
    assert status==200,(status,connected)
    code=json.loads(connected['connection']); key=code['capture']
    assert code['site']=='local-shortcut-test-gateway'
    assert http('/api/workspace',key=key)[0]==401
    assert http('/api/shortcuts/connection',{'action':'connect'},owner=True,origin='https://untrusted.example')[0]==403
    status,nonce=http('/api/shortcuts/capture',key=key); assert status==200
    source='Fix HP Studios booking button, check mobile & publish #1 — “quoted”\nKeep all steps together.'
    body={'source':source,'requestId':nonce['requestId']}
    status,result=http('/api/shortcuts/capture',body,key=key)
    assert status==200 and result['ok'] is True,(status,result)
    created_ids.add(result['taskId'])
    assert result['message'].startswith('Saved to Followthrough as Ready.')
    status,retry=http('/api/shortcuts/capture',{**body,'source':'Changed retry text'},key=key)
    assert status==200 and retry['taskId']==result['taskId']
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        outputs=list(pool.map(lambda _:http('/api/shortcuts/capture',body,key=key),range(5)))
    assert all(status==200 and data['taskId']==result['taskId'] for status,data in outputs)
    assert http('/api/shortcuts/capture',{**body,'action':'complete_task'},key=key)[0]==400
    assert http('/api/shortcuts/capture',{**body,'source':' '},key=key)[0]==400
    state=http('/api/workspace',owner=True)[1]
    tasks=[t for t in state['tasks'] if t['id'] in created_ids]
    assert len(tasks)==1 and tasks[0]['source']==source and tasks[0]['status']=='ready'
    assert any(b['taskId'] in created_ids for b in state['blocks'])
    new=json.loads(http('/api/shortcuts/connection',{'action':'connect'},owner=True)[1]['connection'])['capture']
    assert http('/api/shortcuts/capture',key=key)[0]==401
    for _ in range(20): assert http('/api/shortcuts/capture',key=new)[0]==200
    assert http('/api/shortcuts/capture',key=new)[0]==429
    assert http('/api/shortcuts/connection',{'action':'disconnect'},owner=True)[0]==200
    assert http('/api/shortcuts/capture',key=new)[0]==401
    print('PASS: authenticated save/readback, automatic planning, unicode, no workspace access, duplicate and parallel retries, rejected actions, rotation, rate limiting, and revocation.')
finally:
    http('/api/shortcuts/connection',{'action':'disconnect'},owner=True)
    state=http('/api/workspace',owner=True)[1]
    revision=state['revision']
    for k in ['revision','warnings','currentDate','integrations']: state.pop(k,None)
    state['tasks']=[t for t in state['tasks'] if t['id'] not in created_ids]
    state['blocks']=[b for b in state['blocks'] if b['taskId'] not in created_ids]
    state['recentRequests']=[r for r in state['recentRequests'] if r not in created_ids]
    def quote(value): return "'"+str(value).replace("'","''")+"'"
    sql=Path('.wrangler/cleanup-shortcut-tests.sql')
    # Only the local simulated owner has a document containing these exact test task IDs.
    if created_ids:
        taskid=next(iter(created_ids))
        sql.write_text('UPDATE workspaces SET document = '+quote(json.dumps(state))+' WHERE revision = '+str(revision)+' AND instr(document, '+quote(taskid)+') > 0;')
        env={**os.environ,'WRANGLER_WRITE_LOGS':'false'}
        subprocess.run(['npm','exec','wrangler','--','d1','execute','DB','--local','--config','.wrangler/migrate.json','--persist-to','.wrangler/state','--file',str(sql)],env=env,stdout=subprocess.DEVNULL,check=True)
        after=http('/api/workspace',owner=True)[1]
        assert not any(t['id'] in created_ids for t in after['tasks']), 'Local test cleanup needs attention'
        print('Local test records removed.')
