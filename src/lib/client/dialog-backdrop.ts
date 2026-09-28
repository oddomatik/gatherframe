/** Dismiss only a click that starts and ends outside the dialog's visible box. */
export function dismissOnBackdrop(dialog: HTMLDialogElement) {
  let startedOutside = false;
  const outside = (event: MouseEvent) => {
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };
  const down = (event: PointerEvent) => { startedOutside = event.target === dialog && outside(event); };
  const click = (event: MouseEvent) => {
    if (startedOutside && event.target === dialog && outside(event)) dialog.close();
    startedOutside = false;
  };
  const reset = () => { startedOutside = false; };
  dialog.addEventListener('pointerdown', down);
  dialog.addEventListener('click', click);
  dialog.addEventListener('close', reset);
  return { destroy() { dialog.removeEventListener('pointerdown', down); dialog.removeEventListener('click', click); dialog.removeEventListener('close', reset); } };
}
