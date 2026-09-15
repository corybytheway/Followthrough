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

// A calendar click loads this inert page first. Its browser script immediately
// submits POST, so ordinary link-preview GET requests cannot change a task.
function doGet(event) {
  const input = calendarActionInput_(event && event.parameter);
  if (!input)
    return actionPage_('Link unavailable', 'This Followthrough task link is invalid.', true);
  const endpoint = ScriptApp.getService().getUrl().replace(
    /^https:\/\/script\.google\.com\/(?:a\/[^/]+\/)?macros\//,
    'https://script.google.com/macros/'
  );
  const fields = Object.keys(input).map(function(key) {
    return '<input type="hidden" name="' + escapeHtml_(key) + '" value="' +
      escapeHtml_(input[key]) + '">';
  }).join('');
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Followthrough</title></head><body>' +
    '<main><div class="bolt">⚡️</div><h1>Updating Followthrough…</h1>' +
    '<p>This task action will finish automatically.</p>' +
    '<form id="task-action" method="post" action="' + escapeHtml_(endpoint) + '">' + fields + '</form></main>' +
    actionStyle_() + '<script>document.getElementById("task-action").submit();</script></body></html>'
  ).setTitle('Followthrough');
}

function doPost(event) {
  const parameters = event && event.parameter;
  const input = calendarActionInput_(parameters);
  if (!input)
    return actionResponse_(parameters, 'Link unavailable', 'This Followthrough task link is invalid.', true, {
      ok: false,
      error: 'This Followthrough task link is invalid.'
    });
  try {
    const properties = PropertiesService.getScriptProperties();
    const gateway = properties.getProperty('SITES_GATEWAY_TOKEN');
    const key = properties.getProperty('SCHEDULER_KEY');
    if (!gateway || !key) throw new Error('Followthrough is not configured.');
    const response = UrlFetchApp.fetch(
      'https://followthrough.corybytheway.chatgpt.site/api/calendars/action',
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(input),
        headers: {
          'OAI-Sites-Authorization': 'Bearer ' + gateway,
          'x-followthrough-scheduler-key': key
        },
        followRedirects: false,
        muteHttpExceptions: true
      }
    );
    let result;
    try { result = JSON.parse(response.getContentText()); }
    catch (_) { throw new Error('Followthrough returned an unexpected response.'); }
    if (response.getResponseCode() !== 200 || result.ok !== true)
      return actionResponse_(parameters, 'Could not update task', result.error || 'Open the latest calendar event and try again.', true, result);
    return actionResponse_(parameters, 'Done', result.message || 'Followthrough updated the task.', false, result);
  } catch (error) {
    const message = error.message || 'Try again from the latest calendar event.';
    return actionResponse_(parameters, 'Could not update task', message, true, { ok: false, error: message });
  }
}

function actionResponse_(parameters, title, message, isError, result) {
  if (parameters && parameters.relay === '1')
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  return actionPage_(title, message, isError);
}

function calendarActionInput_(parameters) {
  if (!parameters) return null;
  const action = String(parameters.action || '');
  const input = {
    task: String(parameters.task || ''),
    action: action,
    stamp: String(parameters.stamp || ''),
    signature: String(parameters.signature || '')
  };
  if (!/^(complete|postpone|delete)$/.test(action) ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(input.task) ||
      !/^[0-9TZ:._+-]{10,40}$/.test(input.stamp) ||
      !/^[a-f0-9]{64}$/.test(input.signature)) return null;
  return input;
}

function actionPage_(title, message, isError) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Followthrough</title></head><body><main>' +
    '<div class="bolt">' + (isError ? '!' : '⚡️') + '</div><h1>' + escapeHtml_(title) + '</h1>' +
    '<p>' + escapeHtml_(message) + '</p><p>You can close this page.</p></main>' +
    actionStyle_() + '</body></html>'
  ).setTitle('Followthrough');
}

function actionStyle_() {
  return '<style>html{color-scheme:light}body{margin:0;background:#f7f9fc;color:#15243b;' +
    'font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{box-sizing:border-box;' +
    'max-width:520px;margin:12vh auto;padding:32px;text-align:center;background:white;border:1px solid #dbe3ef;' +
    'border-radius:18px;box-shadow:0 18px 55px rgba(21,36,59,.1)}.bolt{font-size:38px}h1{font-size:28px;' +
    'margin:14px 0 10px}p{color:#60718a;line-height:1.55;margin:8px 0}</style>';
}

function escapeHtml_(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
