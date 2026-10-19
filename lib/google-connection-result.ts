// Created by Cory McCabe
/** Consume OAuth outcome parameters once while retaining unrelated URL state. */
export function googleConnectionResult(location: URL) {
  const gmail = location.searchParams.get('gmail');
  const calendar = location.searchParams.get('calendar');
  location.searchParams.delete('gmail');
  location.searchParams.delete('calendar');
  if (!gmail && !calendar) return null;
  const connected = (gmail || calendar) === 'connected';
  return {
    connected,
    message: gmail
      ? connected
        ? 'Gmail suggestions connected.'
        : 'Gmail connection was not completed. Try connecting again in Settings.'
      : connected
        ? 'Google connected. Select the calendars that should block task time.'
        : 'Google connection was not completed. Try connecting again in Settings.',
  };
}
