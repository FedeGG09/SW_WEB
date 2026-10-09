import { PLAYER_CHARACTERS, type PlayerCharacterId } from '../../player/PlayerCharacterConfig';

/** DEV-only page reinitialization selector. A navigation reload disposes the
 * old scene/controller/camera before the next profile is assigned. */
export function addDevPlayableCharacterSelector(
  parent: HTMLElement,
  current: PlayerCharacterId,
  options: { keepParty?: boolean; title?: string } = {},
) {
  const label = document.createElement('label');
  label.title = options.title ?? 'Switch playable character; DEV scene will reload cleanly.';
  label.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin:3px;padding:3px 7px;border:1px solid #6c9298;border-radius:5px;background:#102129;color:#e8f3f4;font:11px ui-monospace,Consolas,monospace;pointer-events:auto';
  label.append('PLAY AS');
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Playable character');
  select.style.cssText = 'background:#102129;color:#e8f3f4;border:0;padding:4px;cursor:pointer';
  const ids: PlayerCharacterId[] = ['aren', 'jolee', 'nara-original', 'nara-belaya'];
  for (const id of ids) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = PLAYER_CHARACTERS[id].displayName;
    option.selected = current === id;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('playable', select.value);
    if (select.value === 'nara-belaya') url.searchParams.set('naraVariant', 'belaya');
    else if (select.value === 'nara-original') url.searchParams.set('naraVariant', 'original');
    else url.searchParams.delete('naraVariant');
    url.searchParams.delete('player');
    if (options.keepParty) url.searchParams.set('party', '1');
    window.location.assign(url.toString());
  });
  label.appendChild(select);
  parent.appendChild(label);
  return select;
}
