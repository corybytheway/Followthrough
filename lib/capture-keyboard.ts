// Created by Cory McCabe
type CaptureKeyEvent = {
  key: string;
  shiftKey: boolean;
  repeat: boolean;
  nativeEvent: { isComposing: boolean; keyCode: number };
  preventDefault(): void;
};

export function handleCaptureKeyDown(
  event: CaptureKeyEvent,
  submit: () => void,
) {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229
  )
    return;

  event.preventDefault();
  if (!event.repeat) submit();
}
