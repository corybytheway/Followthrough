// Created by Cory McCabe
// Private Google Apps Script. Configure SITES_GATEWAY_TOKEN and SCHEDULER_KEY
// in Project Settings > Script Properties. Never paste keys into this source.
function syncFollowthrough() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const gateway = properties.getProperty('SITES_GATEWAY_TOKEN');
    const key = properties.getProperty('SCHEDULER_KEY');
    if (!gateway || !key) throw new Error('Configure Followthrough Script Properties first.');
    const response = UrlFetchApp.fetch(
      'https://followthrough.corybytheway.chatgpt.site/api/calendars/background',
      {
        method: 'post',
        contentType: 'application/json',
        payload: '{}',
        headers: {
          'OAI-Sites-Authorization': 'Bearer ' + gateway,
          'x-followthrough-scheduler-key': key
        },
        followRedirects: false,
        muteHttpExceptions: true
      }
    );
    const status = response.getResponseCode();
    if (status !== 200 && status !== 202)
      throw new Error('Followthrough sync returned HTTP ' + status + '. Check Calendar connections.');
    let result;
    try { result = JSON.parse(response.getContentText()); }
    catch (_) { throw new Error('Unexpected Followthrough response. Check scheduler access.'); }
    if (result.ok !== true) throw new Error('Followthrough could not sync. Check Calendar connections.');
    console.log(result.skipped ? 'Sync skipped: paused, recent, or already running.' : 'Calendar sync completed.');
  } finally {
    lock.releaseLock();
  }
}

function installFollowthroughScheduler() {
  syncFollowthrough();
  const existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'syncFollowthrough';
  });
  if (existing.length === 0)
    ScriptApp.newTrigger('syncFollowthrough').timeBased().everyMinutes(5).create();
  existing.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  console.log('Followthrough timer installed: every five minutes.');
}
