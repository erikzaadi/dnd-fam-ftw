// z-index layers used across the app - use these instead of arbitrary z-[N] values
export const Z = {
  tooltip: 'z-50',      // hover tooltips
  hud: 'z-[60]',       // fixed HUD/header overlays
  popover: 'z-[200]',  // dropdown menus, popovers
  modal: 'z-[200]',    // modal backdrops
  dialog: 'z-[300]',   // confirmation dialogs (above modals)
} as const;
