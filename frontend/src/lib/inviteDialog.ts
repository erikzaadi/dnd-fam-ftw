// "Invite your party" can be opened from the account menu, the Home tutorial, and the
// Home tip. The dialog lives in the account menu; others ask for it with this event.
const EVENT = 'dnd:open-invite-dialog';

export const openInviteDialog = () => {
  window.dispatchEvent(new Event(EVENT));
};

export const onOpenInviteDialog = (handler: () => void): (() => void) => {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
};
