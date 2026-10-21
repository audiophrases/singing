import { h } from '../ui.js';
import { getSettings, setSettings } from '../store.js';

// One browser preference shared by song, folder, assignment and backup uploads.
export function songPermissionCheckbox() {
  return h('input', {
    type: 'checkbox', checked: getSettings().songUploadPermission === true,
    'data-song-permission': '',
    onchange: (event) => {
      const checked = event.currentTarget.checked;
      setSettings({ songUploadPermission: checked });
      document.querySelectorAll('[data-song-permission]').forEach((input) => { input.checked = checked; });
    },
  });
}
