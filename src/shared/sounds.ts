// Notification sounds on Windows: the toast sounds Windows itself offers (ms-winsoundevent:Notification.<name>).
// Settings keep one sound name per tier, so a value saved on a Mac (Glass for pinned, Tink for others) keeps its role.

export const WIN_SOUNDS = ['Reminder', 'IM', 'Mail', 'SMS', 'Default', 'None'] as const;
export type WinSound = (typeof WIN_SOUNDS)[number];

export const WIN_SOUND_LABEL: Record<WinSound, string> = {
  Reminder: 'Sound: Reminder', IM: 'Sound: Message', Mail: 'Sound: Mail', SMS: 'Sound: Text', Default: 'Sound: Windows default', None: 'No sound',
};

export function winSound(name: string | undefined): WinSound {
  if ((WIN_SOUNDS as readonly string[]).includes(name ?? '')) return name as WinSound;
  return name === 'Glass' ? 'Reminder' : name === 'Tink' ? 'IM' : 'Default';
}
