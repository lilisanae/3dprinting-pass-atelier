/** Attach only while dirty; the browser supplies its own confirmation text. */
export function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = true;
}
