'use strict';
// Lakalaka icons. ONE semantic wrapper for the whole client: icon(name)
// returns an inline SVG string, and any element carrying data-icon="name"
// gets the glyph filled in on load. Glyphs are IconSax style: 24 viewBox,
// stroke currentColor, no fill, one consistent stroke width. Everything is
// drawn here as paths. No icon font, no CDN, nothing fetched.
//
// Name map (the single source of truth):
//   add-circle  Create a room      flash    Quick play
//   login       Join room          link     Copy invite link
//   share       Share              play     Start game
//   logout      Leave room         refresh  Play again
//   trophy      Top players        history  Past games
const ICON_PATHS = {
  'add-circle': '<circle cx="12" cy="12" r="8.6"/><path d="M12 8.4v7.2M8.4 12h7.2"/>',
  'flash': '<path d="M13.2 3.2 5.6 13.1c-.25.33.02.8.44.8H11l-1.1 6.9 7.9-10.2c.25-.33-.02-.79-.44-.79h-5l.84-6.6z"/>',
  'login': '<path d="M14.2 5h2.6A2.2 2.2 0 0 1 19 7.2v9.6a2.2 2.2 0 0 1-2.2 2.2h-2.6"/><path d="M3.2 12h10.6"/><path d="M10.4 8.2 14.2 12l-3.8 3.8"/>',
  'link': '<path d="M10.6 13.4a4.3 4.3 0 0 0 6 0l2.7-2.7a4.3 4.3 0 1 0-6-6l-1.4 1.4"/><path d="M13.4 10.6a4.3 4.3 0 0 0-6 0l-2.7 2.7a4.3 4.3 0 1 0 6 6l1.4-1.4"/>',
  'share': '<circle cx="6" cy="12" r="2.6"/><circle cx="17.6" cy="5.6" r="2.6"/><circle cx="17.6" cy="18.4" r="2.6"/><path d="M8.3 10.7 15.2 6.8M8.3 13.3l6.9 3.9"/>',
  'play': '<path d="M8.2 5.9v12.2c0 .9 1 1.5 1.8 1L19.3 13a1.15 1.15 0 0 0 0-2L10 4.9c-.8-.5-1.8.1-1.8 1z"/>',
  'logout': '<path d="M9.8 5H7.2A2.2 2.2 0 0 0 5 7.2v9.6A2.2 2.2 0 0 0 7.2 19h2.6"/><path d="M20.8 12H10.2"/><path d="M17.4 8.2 21.2 12l-3.8 3.8"/>',
  'refresh': '<path d="M20.1 12a8.1 8.1 0 1 1-2.4-5.8"/><path d="M20.4 3.6v4.1h-4.1"/>',
  'trophy': '<path d="M7.6 4.2h8.8v4.6a4.4 4.4 0 0 1-8.8 0V4.2z"/><path d="M7.6 5.8H5.3c0 2.9 1.3 4.4 3.4 4.7M16.4 5.8h2.3c0 2.9-1.3 4.4-3.4 4.7"/><path d="M12 13.2v2.9"/><path d="M9.3 19.6c.5-1.9 1.4-2.8 2.7-2.8s2.2.9 2.7 2.8"/><path d="M8.4 19.6h7.2"/>',
  'history': '<path d="M4.6 12.4a7.6 7.6 0 1 1 2.1 5.2"/><path d="M4.2 18v-4.2h4.2"/><path d="M12 7.8v4.4l3 1.9"/>'
};

function icon(name) {
  const paths = ICON_PATHS[name] || '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths + '</svg>';
}
window.icon = icon;

// Fill every placeholder the markup declares. Buttons keep their text
// labels; the icon sits beside the label, never instead of it.
document.querySelectorAll('[data-icon]').forEach((el) => {
  el.innerHTML = icon(el.getAttribute('data-icon'));
});
